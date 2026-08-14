import {
	Inject,
	Injectable,
	type OnApplicationBootstrap,
	type OnModuleDestroy,
} from "@nestjs/common";
import { McpClientRuntime } from "@nestm/mcp-client";
import { McpGateway, createMcpClientRuntimeUpstream, createMcpGateway } from "@nestm/mcp-gateway";
import { McpServerRegistry, type McpServerRuntime } from "@nestm/mcp-server";
import { McpModuleError } from "./mcp.errors.ts";
import { assertMcpCatalogExposureOptions } from "./mcp-catalog.runtime.ts";
import { MCP_MODULE_OPTIONS } from "./mcp.tokens.ts";
import type {
	McpModuleOptions,
	McpNestGatewayOptions,
	McpNestGatewayUpstreamDefinition,
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
		readonly servers: McpServerRegistry,
		private readonly explorer: McpHandlerExplorer,
		/** Live, copy-on-write capability registry used by future request server builds. */
		readonly capabilities: McpHandlerRegistry,
	) {}

	async onApplicationBootstrap(): Promise<void> {
		try {
			if (this.options.autoDiscover !== false) this.explorer.scan();
			const definitions = this.options.servers ?? [];
			for (const definition of definitions) {
				if (definition.catalogExposure === undefined) continue;
				assertMcpCatalogExposureOptions(definition.catalogExposure, definition.name);
				if (definition.gateway !== undefined) {
					throw new McpModuleError(
						"INVALID_CATALOG_EXPOSURE",
						`MCP catalog exposure cannot be combined with gateway server "${definition.name}".`,
					);
				}
				if ((definition.features?.length ?? 0) > 0) {
					throw new McpModuleError(
						"INVALID_CATALOG_EXPOSURE",
						`MCP catalog exposure for server "${definition.name}" cannot safely project tools from arbitrary custom features. Register cataloged tools through decorators or the live capability registry.`,
					);
				}
			}
			this.capabilities.configureRuntimes(
				definitions.map(({ name }) => name),
				definitions.flatMap(({ name, gateway }) => (gateway === undefined ? [] : [name])),
				definitions.flatMap(({ name, catalogExposure }) =>
					catalogExposure === undefined ? [] : [name],
				),
			);
			for (const definition of definitions) {
				const {
					catalogExposure,
					gateway,
					handlerAuthorization,
					handlerLifecycleObserver,
					handlerMiddleware,
					handlerVisibilityTimeoutMs,
					principalClaims,
					...serverDefinition
				} = definition;
				if (gateway !== undefined && this.capabilities.hasHandlersFor(definition.name)) {
					throw new McpModuleError(
						"INVALID_OPTIONS",
						`MCP gateway server "${definition.name}" must be dedicated and cannot also host decorated tools, prompts, or resources.`,
					);
				}
				const discovered = this.capabilities.asServerFeature({
					serverName: definition.name,
					...(catalogExposure === undefined ? {} : { catalogExposure }),
					...(handlerAuthorization === undefined ? {} : { authorization: handlerAuthorization }),
					...(handlerMiddleware === undefined ? {} : { middleware: handlerMiddleware }),
					...(handlerLifecycleObserver === undefined
						? {}
						: { lifecycleObserver: handlerLifecycleObserver }),
					...(handlerVisibilityTimeoutMs === undefined
						? {}
						: { visibilityTimeoutMs: handlerVisibilityTimeoutMs }),
				});
				const features = [...(serverDefinition.features ?? [])];
				// Discovery may be disabled while live registry APIs remain enabled.
				if (gateway === undefined) features.push(discovered);
				if (gateway !== undefined) {
					features.push(this.#createGatewayFeature(definition.name, gateway));
				}
				this.servers.register({
					...serverDefinition,
					...(principalClaims === undefined ? {} : { principalClaims }),
					...(features.length === 0 ? {} : { features }),
				});
			}
			this.#unsubscribeCapabilityMutations = this.capabilities.onMutation(
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
		const upstreams = options.upstreams.map((definition) => {
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
		const gateway = createMcpGateway({ ...options, upstreams });
		this.#gateways.set(serverName, gateway);
		return gateway.asServerFeature();
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
