import {
	Inject,
	Injectable,
	type OnApplicationBootstrap,
	type OnModuleDestroy,
} from "@nestjs/common";
import { McpClientRuntime } from "@nestm/mcp-client";
import { McpGateway, createMcpClientRuntimeUpstream } from "@nestm/mcp-gateway";
import type { McpGatewayPolicy } from "@nestm/mcp-gateway";
import { McpServerRegistry, type McpServerFeature, type McpServerRuntime } from "@nestm/mcp-server";
import { McpCapabilitiesService } from "./mcp-capabilities.service.ts";
import type { McpCatalogExposurePolicy } from "./mcp-catalog-exposure.ts";
import { McpModuleError } from "./mcp.errors.ts";
import { McpProviderRegistry, mcpProviderTokenName } from "./mcp-provider.registry.ts";
import { assertMcpCatalogExposureOptions } from "./mcp-catalog.runtime.ts";
import { MCP_MODULE_OPTIONS } from "./mcp.tokens.ts";
import type {
	McpHandlerAuthorizationPolicy,
	McpHandlerLifecycleObserver,
	McpHandlerMiddlewareProvider,
	McpModuleOptions,
	McpNestGatewayOptions,
	McpNestGatewayUpstreamDefinition,
	McpProviderToken,
	McpServerContributor,
	McpServerErrorReporter,
	McpServerLifecycleObserver,
	McpServerMiddlewareProvider,
	McpServerPrincipalClaimsProvider,
	McpServerRuntimeObserverProvider,
} from "./mcp.types.ts";
import { McpHandlerExplorer } from "./discovery/mcp-handler.explorer.ts";
import { McpHandlerRegistry } from "./discovery/mcp-handler.registry.ts";

@Injectable()
export class McpRuntimeService implements OnApplicationBootstrap, OnModuleDestroy {
	#ready = false;
	readonly #gateways = new Map<string, McpGateway>();
	#closeTask: Promise<void> | undefined;
	#shutdownError: AggregateError | undefined;
	#unsubscribeCapabilityMutations: (() => void) | undefined;

	constructor(
		@Inject(MCP_MODULE_OPTIONS) private readonly options: McpModuleOptions,
		readonly clients: McpClientRuntime,
		private readonly servers: McpServerRegistry,
		private readonly explorer: McpHandlerExplorer,
		private readonly handlerRegistry: McpHandlerRegistry,
		/** Public live-capability service used by future request server builds. */
		readonly capabilities: McpCapabilitiesService,
		private readonly providers: McpProviderRegistry,
	) {}

	async onApplicationBootstrap(): Promise<void> {
		try {
			this.explorer.assertSingleRoot();
			if (this.options.autoDiscover !== false) this.explorer.scan();
			const definitions = this.options.servers ?? [];
			for (const definition of definitions) {
				if (definition.catalogExposure === undefined) continue;
				if (
					typeof definition.catalogExposure !== "object" ||
					definition.catalogExposure === null ||
					definition.catalogExposure.policy === undefined
				) {
					throw new McpModuleError(
						"INVALID_CATALOG_EXPOSURE",
						`MCP catalog exposure for server "${definition.name}" requires a policy provider token.`,
					);
				}
				if (definition.gateway !== undefined) {
					throw new McpModuleError(
						"INVALID_CATALOG_EXPOSURE",
						`MCP catalog exposure cannot be combined with gateway server "${definition.name}".`,
					);
				}
				if ((definition.contributors?.length ?? 0) > 0) {
					throw new McpModuleError(
						"INVALID_CATALOG_EXPOSURE",
						`MCP catalog exposure for server "${definition.name}" cannot safely project tools from custom contributors. Register cataloged tools through decorators or McpCapabilitiesService.`,
					);
				}
			}
			this.handlerRegistry.configureRuntimes(
				definitions.map(({ name }) => name),
				definitions.flatMap(({ name, gateway }) => (gateway === undefined ? [] : [name])),
				definitions.flatMap(({ name, catalogExposure }) =>
					catalogExposure === undefined ? [] : [name],
				),
			);
			for (const definition of definitions) {
				const {
					catalogExposure,
					contributors: contributorTokens,
					gateway,
					handlerAuthorization: handlerAuthorizationToken,
					handlerLifecycleObserver: handlerLifecycleObserverToken,
					handlerMiddleware: handlerMiddlewareTokens,
					handlerVisibilityTimeoutMs,
					lifecycleObserver: lifecycleObserverToken,
					middleware: middlewareTokens,
					observer: observerToken,
					onError: errorReporterToken,
					principalClaims: principalClaimsToken,
					...serverDefinition
				} = definition;
				const contributors = this.#providerTokenList(
					contributorTokens,
					definition.name,
					"contributors",
				).map((token) =>
					this.#resolveProvider<McpServerContributor>(
						token,
						definition.name,
						"contributor",
						"contribute",
					),
				);
				const catalogPolicy =
					catalogExposure === undefined
						? undefined
						: this.#resolveProvider<McpCatalogExposurePolicy>(
								catalogExposure.policy,
								definition.name,
								"catalog exposure policy",
								"resolve",
							);
				const resolvedCatalogExposure =
					catalogPolicy === undefined
						? undefined
						: Object.freeze({
								resolver: (input: Parameters<McpCatalogExposurePolicy["resolve"]>[0]) =>
									catalogPolicy.resolve(input),
							});
				if (resolvedCatalogExposure !== undefined) {
					assertMcpCatalogExposureOptions(resolvedCatalogExposure, definition.name);
				}
				const handlerAuthorization =
					handlerAuthorizationToken === undefined
						? undefined
						: this.#resolveProvider<McpHandlerAuthorizationPolicy>(
								handlerAuthorizationToken,
								definition.name,
								"handler authorization policy",
								"authorize",
							);
				const handlerMiddleware = this.#providerTokenList(
					handlerMiddlewareTokens,
					definition.name,
					"handlerMiddleware",
				).map((token) => {
					const provider = this.#resolveProvider<McpHandlerMiddlewareProvider>(
						token,
						definition.name,
						"handler middleware",
						"handle",
					);
					return provider.handle.bind(provider);
				});
				const handlerLifecycleObserver =
					handlerLifecycleObserverToken === undefined
						? undefined
						: this.#resolveProvider<McpHandlerLifecycleObserver>(
								handlerLifecycleObserverToken,
								definition.name,
								"handler lifecycle observer",
								"onEvent",
							);
				const principalClaimsProvider =
					principalClaimsToken === undefined
						? undefined
						: this.#resolveProvider<McpServerPrincipalClaimsProvider>(
								principalClaimsToken,
								definition.name,
								"principal claims provider",
								"resolvePrincipalClaims",
							);
				const middleware = this.#providerTokenList(
					middlewareTokens,
					definition.name,
					"middleware",
				).map((token) => {
					const provider = this.#resolveProvider<McpServerMiddlewareProvider>(
						token,
						definition.name,
						"server middleware",
						"handle",
					);
					return provider.handle.bind(provider);
				});
				const lifecycleObserver =
					lifecycleObserverToken === undefined
						? undefined
						: this.#resolveProvider<McpServerLifecycleObserver>(
								lifecycleObserverToken,
								definition.name,
								"server lifecycle observer",
								"onEvent",
							);
				const runtimeObserver =
					observerToken === undefined
						? undefined
						: this.#resolveProvider<McpServerRuntimeObserverProvider>(
								observerToken,
								definition.name,
								"server runtime observer",
								"observe",
							);
				const errorReporter =
					errorReporterToken === undefined
						? undefined
						: this.#resolveProvider<McpServerErrorReporter>(
								errorReporterToken,
								definition.name,
								"server error reporter",
								"report",
							);
				if (
					gateway !== undefined &&
					(this.handlerRegistry.hasHandlersFor(definition.name) || contributors.length > 0)
				) {
					throw new McpModuleError(
						"INVALID_OPTIONS",
						`MCP gateway server "${definition.name}" must be dedicated and cannot also host decorated or contributed capabilities.`,
					);
				}
				const discovered = this.handlerRegistry.asServerFeature({
					serverName: definition.name,
					...(resolvedCatalogExposure === undefined
						? {}
						: { catalogExposure: resolvedCatalogExposure }),
					...(handlerAuthorization === undefined ? {} : { authorization: handlerAuthorization }),
					...(handlerMiddleware.length === 0 ? {} : { middleware: handlerMiddleware }),
					...(handlerLifecycleObserver === undefined
						? {}
						: { lifecycleObserver: handlerLifecycleObserver }),
					...(handlerVisibilityTimeoutMs === undefined
						? {}
						: { visibilityTimeoutMs: handlerVisibilityTimeoutMs }),
				});
				const features: McpServerFeature[] = [];
				// Discovery may be disabled while live registry APIs remain enabled.
				if (gateway === undefined) features.push(discovered);
				if (contributors.length > 0) {
					features.push(async (server, context) => {
						for (const contributor of contributors) await contributor.contribute(server, context);
					});
				}
				if (gateway !== undefined) {
					features.push(this.#createGatewayFeature(definition.name, gateway));
				}
				this.servers.register({
					...serverDefinition,
					...(principalClaimsProvider === undefined
						? {}
						: {
								principalClaims: (authInfo) =>
									principalClaimsProvider.resolvePrincipalClaims(authInfo),
							}),
					...(middleware.length === 0 ? {} : { middleware }),
					...(lifecycleObserver === undefined ? {} : { lifecycleObserver }),
					...(runtimeObserver === undefined
						? {}
						: { observer: (event) => runtimeObserver.observe(event) }),
					...(errorReporter === undefined
						? {}
						: { onError: (error) => errorReporter.report(error) }),
					...(features.length === 0 ? {} : { features }),
				});
			}
			this.#unsubscribeCapabilityMutations = this.handlerRegistry.onMutation(
				({ kind, serverNames }) => {
					for (const serverName of serverNames) {
						try {
							const notifier = this.servers.get(serverName).notify;
							if (kind === "tool") notifier.toolsChanged();
							else if (kind === "prompt") notifier.promptsChanged();
							else notifier.resourcesChanged();
						} catch {
							// A committed registry mutation remains valid if publication races shutdown.
						}
					}
				},
			);
			if (this.options.connectClientsOnBootstrap === true) {
				await this.clients.connectAll();
			}
			this.#ready = true;
		} catch (bootstrapError) {
			try {
				await this.close();
			} catch (cleanupError) {
				// Both caught failures are retained explicitly in AggregateError.errors.
				// oxlint-disable-next-line eslint/preserve-caught-error
				throw new AggregateError(
					[bootstrapError, cleanupError],
					"MCP bootstrap failed and its partially initialized runtimes could not close cleanly.",
					{ cause: bootstrapError },
				);
			}
			throw bootstrapError;
		}
	}

	server(name: string): McpServerRuntime {
		this.#assertReady();
		return this.servers.get(name);
	}

	client(name: string): ReturnType<McpClientRuntime["requireClient"]> {
		this.#assertReady();
		return this.clients.requireClient(name);
	}

	/** Returns the aggregate gateway owned by one configured inbound server. */
	gateway(serverName: string): McpGateway {
		this.#assertReady();
		const gateway = this.#gateways.get(serverName);
		if (gateway === undefined) {
			throw new McpModuleError(
				"UNKNOWN_GATEWAY",
				`No MCP gateway is configured for server "${serverName}".`,
			);
		}
		return gateway;
	}

	listGateways(): readonly McpGateway[] {
		this.#assertReady();
		return Object.freeze([...this.#gateways.values()]);
	}

	isReady(): boolean {
		return this.#ready;
	}

	/** Last cleanup failure contained by the Nest lifecycle hook, if any. */
	get shutdownError(): AggregateError | undefined {
		return this.#shutdownError;
	}

	/** Explicit shutdown API. Unlike the Nest hook, this rejects on cleanup failure. */
	close(): Promise<void> {
		if (this.#closeTask !== undefined) return this.#closeTask;
		this.#ready = false;
		this.#closeTask = Promise.resolve().then(() => this.#performClose());
		return this.#closeTask;
	}

	async onModuleDestroy(): Promise<void> {
		try {
			await this.close();
		} catch {
			// Nest aborts adapter disposal when a destroy hook rejects. The error remains
			// available through shutdownError and the explicit close() promise.
		}
	}

	async #performClose(): Promise<void> {
		const errors: unknown[] = [];
		this.#unsubscribeCapabilityMutations?.();
		this.#unsubscribeCapabilityMutations = undefined;
		this.handlerRegistry.close();
		// Stop accepting inbound gateway work before closing its upstream clients.
		try {
			await this.servers.close();
		} catch (error) {
			errors.push(error);
		}
		const gatewayResults = await Promise.allSettled(
			[...this.#gateways.values()].map(async (gateway) => gateway.close()),
		);
		for (const result of gatewayResults) {
			if (result.status === "rejected") errors.push(result.reason);
		}
		try {
			await this.clients.close();
		} catch (error) {
			errors.push(error);
		}
		this.#gateways.clear();
		if (errors.length > 0) {
			this.#shutdownError = new AggregateError(errors, "One or more MCP runtimes failed to close.");
			throw this.#shutdownError;
		}
	}

	#assertReady(): void {
		if (!this.#ready) {
			throw new McpModuleError(
				"RUNTIME_NOT_READY",
				"The MCP runtime is not ready until Nest application bootstrap completes.",
			);
		}
	}

	#createGatewayFeature(serverName: string, options: McpNestGatewayOptions) {
		const { policy: policyToken, upstreams: upstreamDefinitions, ...gatewayOptions } = options;
		const policy = this.#bindGatewayPolicy(
			this.#resolveProvider<McpGatewayPolicy>(
				policyToken,
				serverName,
				"gateway policy",
				"authorize",
			),
			serverName,
		);
		if (!Array.isArray(upstreamDefinitions)) {
			throw new McpModuleError(
				"INVALID_OPTIONS",
				`MCP gateway upstreams for server "${serverName}" must be an array.`,
			);
		}
		const upstreams = upstreamDefinitions.map((definition) => {
			if (isResolvedGatewayUpstream(definition)) return definition;
			const normalized = normalizeGatewayUpstream(definition);
			if (!this.clients.has(normalized.clientName)) {
				throw new McpModuleError(
					"UNKNOWN_CLIENT",
					`Gateway upstream references unknown MCP client "${normalized.clientName}".`,
				);
			}
			return createMcpClientRuntimeUpstream(
				this.clients,
				normalized.clientName,
				normalized.gatewayName,
			);
		});
		const gateway = new McpGateway({ ...gatewayOptions, policy, upstreams });
		this.#gateways.set(serverName, gateway);
		return gateway.asServerFeature();
	}

	#resolveProvider<Value>(
		token: McpProviderToken<Value>,
		serverName: string,
		role: string,
		method: string,
	): Value {
		try {
			const provider = this.providers.get(token);
			if (
				(typeof provider !== "object" && typeof provider !== "function") ||
				provider === null ||
				typeof Reflect.get(provider, method) !== "function"
			) {
				throw new TypeError(`resolved provider does not implement ${method}()`);
			}
			// The configured contract for every collaborator is structural and method-based.
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion
			return provider as Value;
		} catch (cause) {
			throw new McpModuleError(
				"INVALID_OPTIONS",
				`MCP ${role} ${mcpProviderTokenName(token)} for server "${serverName}" must be listed in McpModule collaborators.providers and implement ${method}().`,
				{ cause },
			);
		}
	}

	#providerTokenList<Value>(
		value: readonly McpProviderToken<Value>[] | undefined,
		serverName: string,
		field: string,
	): readonly McpProviderToken<Value>[] {
		if (value === undefined) return [];
		if (Array.isArray(value)) return value;
		throw new McpModuleError(
			"INVALID_OPTIONS",
			`MCP server "${serverName}" ${field} must be an array of collaborator provider tokens.`,
		);
	}

	#bindGatewayPolicy(policy: McpGatewayPolicy, serverName: string): McpGatewayPolicy {
		const { authorizePrompt, authorizeResource, authorizeResourceTemplate } = policy;
		for (const [name, hook] of [
			["authorizePrompt", authorizePrompt],
			["authorizeResource", authorizeResource],
			["authorizeResourceTemplate", authorizeResourceTemplate],
		] as const) {
			if (hook !== undefined && typeof hook !== "function") {
				throw new McpModuleError(
					"INVALID_OPTIONS",
					`MCP gateway policy for server "${serverName}" has a non-callable ${name} hook.`,
				);
			}
		}
		return Object.freeze({
			authorize: (operation: Parameters<McpGatewayPolicy["authorize"]>[0]) =>
				policy.authorize(operation),
			...(authorizePrompt === undefined
				? {}
				: {
						authorizePrompt: (
							operation: Parameters<NonNullable<McpGatewayPolicy["authorizePrompt"]>>[0],
						) => authorizePrompt.call(policy, operation),
					}),
			...(authorizeResource === undefined
				? {}
				: {
						authorizeResource: (
							operation: Parameters<NonNullable<McpGatewayPolicy["authorizeResource"]>>[0],
						) => authorizeResource.call(policy, operation),
					}),
			...(authorizeResourceTemplate === undefined
				? {}
				: {
						authorizeResourceTemplate: (
							operation: Parameters<NonNullable<McpGatewayPolicy["authorizeResourceTemplate"]>>[0],
						) => authorizeResourceTemplate.call(policy, operation),
					}),
		});
	}
}

function isResolvedGatewayUpstream(
	definition: McpNestGatewayUpstreamDefinition,
): definition is Extract<McpNestGatewayUpstreamDefinition, { readonly client: unknown }> {
	return typeof definition === "object" && definition !== null && "client" in definition;
}

function normalizeGatewayUpstream(definition: McpNestGatewayUpstreamDefinition): {
	readonly clientName: string;
	readonly gatewayName: string;
} {
	if (isResolvedGatewayUpstream(definition)) {
		throw new McpModuleError(
			"INVALID_OPTIONS",
			"A resolved gateway upstream cannot be normalized as a named client alias.",
		);
	}
	const clientName = typeof definition === "string" ? definition : definition.clientName;
	const gatewayName =
		typeof definition === "string" ? definition : (definition.gatewayName ?? clientName);
	if (clientName.trim().length === 0 || gatewayName.trim().length === 0) {
		throw new McpModuleError(
			"INVALID_OPTIONS",
			"Nest gateway client and public namespace names must be non-empty strings.",
		);
	}
	return Object.freeze({ clientName, gatewayName });
}
