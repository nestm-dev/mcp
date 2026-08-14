import type {
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
	McpServerDefinition,
	McpServerPrincipal,
	ReadResourceResult,
} from "@nestm/mcp-server";
import type { McpClientRuntimeOptions, McpClientServerDefinition } from "@nestm/mcp-client";
import type { McpGatewayOptions, McpGatewayUpstream } from "@nestm/mcp-gateway";

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

/** Gateway options resolved against the Nest-owned named client runtime. */
export interface McpNestGatewayOptions extends Omit<McpGatewayOptions, "upstreams"> {
	readonly upstreams: readonly McpNestGatewayUpstreamDefinition[];
}

/** Nest-specific handler pipeline layered on a framework-neutral server definition. */
export interface McpNestServerDefinition extends McpServerDefinition {
	/** Runs before custom handler middleware and cannot be bypassed by short-circuit middleware. */
	readonly handlerAuthorization?: McpHandlerAuthorizationPolicy;
	readonly handlerMiddleware?: readonly McpHandlerMiddleware[];
	/** Payload-free lifecycle events for validated tool/resource/prompt invocations. */
	readonly handlerLifecycleObserver?: McpHandlerLifecycleObserver;
	/** Maximum duration of one per-request capability visibility wave. Defaults to 30 seconds. */
	readonly handlerVisibilityTimeoutMs?: number;
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
	/** Make the runtime services globally injectable. Defaults to true. */
	readonly isGlobal?: boolean;
}

export interface McpFeatureOptions {
	/** Modules supplying providers used by the feature's handlers. */
	readonly imports?: import("@nestjs/common").ModuleMetadata["imports"];
	/** Extra providers to register in the feature module. */
	readonly providers?: readonly import("@nestjs/common").Provider[];
	/** Optional subset of feature providers/modules to re-export. Defaults to all providers. */
	readonly exports?: import("@nestjs/common").ModuleMetadata["exports"];
}
