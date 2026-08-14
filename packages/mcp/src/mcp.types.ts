import type {
	MaybePromise,
	McpAuthorizationPolicy,
	McpLifecycleObserver,
	McpOperationContext,
	McpOperationMiddleware,
	McpPassthroughMiddleware,
} from "@nestm/mcp-core";
import type {
	CallToolResult,
	GetPromptResult,
	InputRequiredResult,
	McpServer,
	McpServerBuildContext,
	McpServerDefinition,
	McpServerMiddleware,
	McpServerOperationContext,
	McpServerPrincipal,
	McpServerPrincipalClaimsResolver,
	McpServerRuntimeEvent,
	ReadResourceResult,
} from "@nestm/mcp-server";
import type { InjectionToken, ModuleMetadata, Provider } from "@nestjs/common";
import type { McpClientRuntimeOptions, McpClientServerDefinition } from "@nestm/mcp-client";
import type { McpGatewayOptions, McpGatewayPolicy, McpGatewayUpstream } from "@nestm/mcp-gateway";
import type { McpCatalogExposurePolicy } from "./mcp-catalog-exposure.ts";

export interface McpHandlerInvocationInput {
	readonly kind: "tool" | "resource" | "prompt";
	readonly name: string;
	readonly serverName: string;
	readonly source: string;
	/** Validated callback arguments, excluding the official SDK handler context. */
	readonly arguments: readonly unknown[];
}

export type McpHandlerOperationContext = McpOperationContext<McpServerPrincipal>;
export type McpHandlerInvocationOutputMap = Readonly<{
	tool: CallToolResult | InputRequiredResult;
	resource: ReadResourceResult;
	prompt: GetPromptResult | InputRequiredResult;
}>;
export type McpHandlerInvocationOutputFor<Input extends McpHandlerInvocationInput> =
	McpHandlerInvocationOutputMap[Input["kind"]];
export type McpHandlerInvocationOutput = McpHandlerInvocationOutputFor<McpHandlerInvocationInput>;
export type McpHandlerMiddleware = McpOperationMiddleware<
	McpHandlerInvocationInput,
	McpHandlerInvocationOutput,
	McpHandlerOperationContext
>;
export type McpHandlerPassthroughMiddleware = McpPassthroughMiddleware<
	McpHandlerInvocationInput,
	McpHandlerOperationContext
>;
export type McpHandlerAuthorizationPolicy = McpAuthorizationPolicy<
	McpHandlerInvocationInput,
	McpHandlerOperationContext
>;
export type McpHandlerLifecycleObserver = McpLifecycleObserver<McpHandlerOperationContext>;

export interface McpHandlerMiddlewareProvider {
	handle: McpHandlerMiddleware;
}

export interface McpServerMiddlewareProvider {
	handle: McpServerMiddleware;
}

export type McpServerLifecycleObserver = McpLifecycleObserver<McpServerOperationContext>;

export interface McpServerPrincipalClaimsProvider {
	resolvePrincipalClaims: McpServerPrincipalClaimsResolver;
}

export interface McpServerRuntimeObserverProvider {
	observe(event: McpServerRuntimeEvent): MaybePromise<void>;
}

export interface McpServerErrorReporter {
	report(error: Error): MaybePromise<void>;
}

/** Nest provider that contributes low-level capabilities to one configured server. */
export interface McpServerContributor {
	contribute(server: McpServer, context: McpServerBuildContext): MaybePromise<void>;
}

/** Injection token for a Nest-owned MCP collaborator. */
export type McpProviderToken<Value> = InjectionToken<Value>;

/** Providers and dependency modules owned by the MCP dynamic module. */
export interface McpNestCollaborators {
	readonly imports?: ModuleMetadata["imports"];
	readonly providers?: readonly Provider[];
}

export interface McpNestGatewayUpstream {
	/** Name of a client configured in `McpModuleOptions.clients`. */
	readonly clientName: string;
	/** Optional public namespace exposed by the aggregate gateway. */
	readonly gatewayName?: string;
}

/**
 * A module-owned client alias or a complete framework-neutral upstream.
 *
 * Supplying an `McpGatewayUpstream` is the explicit escape hatch for
 * authorization-aware connection selection such as token exchange or
 * tenant/user-owned clients.
 */
export type McpNestGatewayUpstreamDefinition = string | McpNestGatewayUpstream | McpGatewayUpstream;

/** Gateway options resolved against Nest-owned clients and an injectable policy. */
export interface McpNestGatewayOptions extends Omit<McpGatewayOptions, "policy" | "upstreams"> {
	readonly upstreams: readonly McpNestGatewayUpstreamDefinition[];
	readonly policy: McpProviderToken<McpGatewayPolicy>;
}

export interface McpNestCatalogExposureOptions {
	/** Singleton Nest provider that selects the projection for each serving unit. */
	readonly policy: McpProviderToken<McpCatalogExposurePolicy>;
}

/** Nest-owned server configuration. Raw feature callbacks remain in `@nestm/mcp-server`. */
export interface McpNestServerDefinition extends Omit<
	McpServerDefinition,
	"features" | "lifecycleObserver" | "middleware" | "observer" | "onError" | "principalClaims"
> {
	/** Injectable low-level contributors resolved once during application bootstrap. */
	readonly contributors?: readonly McpProviderToken<McpServerContributor>[];
	/** Injectable projection of verified provider claims onto the safe MCP principal. */
	readonly principalClaims?: McpProviderToken<McpServerPrincipalClaimsProvider>;
	/** Injectable HTTP-exchange middleware providers. */
	readonly middleware?: readonly McpProviderToken<McpServerMiddlewareProvider>[];
	readonly lifecycleObserver?: McpProviderToken<McpServerLifecycleObserver>;
	readonly observer?: McpProviderToken<McpServerRuntimeObserverProvider>;
	readonly onError?: McpProviderToken<McpServerErrorReporter>;
	/** Runs before custom handler middleware and cannot be bypassed by short-circuit middleware. */
	readonly handlerAuthorization?: McpProviderToken<McpHandlerAuthorizationPolicy>;
	readonly handlerMiddleware?: readonly McpProviderToken<McpHandlerMiddlewareProvider>[];
	/** Payload-free lifecycle events for validated tool/resource/prompt invocations. */
	readonly handlerLifecycleObserver?: McpProviderToken<McpHandlerLifecycleObserver>;
	/** Maximum duration of one per-request capability visibility wave. Defaults to 30 seconds. */
	readonly handlerVisibilityTimeoutMs?: number;
	/** Optional authorization-safe projection of the post-visibility tool catalog. */
	readonly catalogExposure?: McpNestCatalogExposureOptions;
	/** Optional aggregate gateway backed by clients owned by this Nest module. */
	readonly gateway?: McpNestGatewayOptions;
}

export interface McpModuleOptions {
	/** Server runtimes compiled at application bootstrap. */
	readonly servers?: readonly McpNestServerDefinition[];
	/** Named upstream servers consumed by the client runtime. */
	readonly clients?: readonly McpClientServerDefinition[];
	/** Shared client middleware, identity, observers, and transport factories. */
	readonly clientRuntime?: Omit<McpClientRuntimeOptions, "servers">;
	/** Establish every configured upstream during application bootstrap. Defaults to false. */
	readonly connectClientsOnBootstrap?: boolean;
	/** Discover decorated Nest providers and attach them to matching servers. Defaults to true. */
	readonly autoDiscover?: boolean;
}

export interface McpModuleExtras {
	/** Make the runtime services globally injectable. Defaults to false. */
	readonly isGlobal?: boolean;
	/** Singleton collaborators whose lifecycle must surround the MCP runtimes they serve. */
	readonly collaborators?: McpNestCollaborators;
}
