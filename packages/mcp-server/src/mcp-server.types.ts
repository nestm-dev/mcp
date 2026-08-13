import type {
	AuthInfo,
	CreateMcpHandlerOptions,
	Implementation,
	McpHandlerRequestOptions,
	McpRequestContext,
	McpServer,
	ServerOptions,
} from "@modelcontextprotocol/server";
import type {
	McpLifecycleObserver,
	McpOperationContext,
	McpOperationMiddleware,
} from "@nestm/mcp-core";

export type MaybePromise<T> = T | PromiseLike<T>;

/** Context passed to each feature whenever the official SDK creates a server instance. */
export interface McpServerBuildContext extends McpRequestContext {
	readonly runtimeName: string;
	/** Token-free verified principal resolved once for this serving unit. */
	readonly principal?: McpServerPrincipal;
}

/**
 * A reusable contribution to an MCP server.
 *
 * Features should only register tools, resources, prompts, and low-level handlers. The official
 * v2 HTTP factory creates a fresh `McpServer` per request, so long-lived pools and caches should be
 * captured outside this function.
 */
export type McpServerFeature = (
	server: McpServer,
	context: McpServerBuildContext,
) => MaybePromise<void>;

export type McpServerRuntimePhase =
	| "build:start"
	| "build:success"
	| "build:error"
	| "handler:error"
	| "close:start"
	| "close:success"
	| "close:error";

/** Lifecycle signal suitable for logs, metrics, and OpenTelemetry adapters. */
export interface McpServerRuntimeEvent {
	readonly phase: McpServerRuntimePhase;
	readonly runtimeName: string;
	readonly timestamp: number;
	readonly durationMs?: number;
	readonly era?: McpRequestContext["era"];
	readonly error?: Error;
}

export type McpServerRuntimeObserver = (event: McpServerRuntimeEvent) => void | PromiseLike<void>;

/** Authenticated identity safe to expose to lifecycle observers (token and provider extras omitted). */
export interface McpServerPrincipal {
	readonly clientId: AuthInfo["clientId"];
	readonly scopes: readonly string[];
	readonly expiresAt?: AuthInfo["expiresAt"];
	/** Canonical resource URL string; strings avoid the mutable internal slots of `URL`. */
	readonly resource?: string;
	/** Explicitly projected verified subject; never inferred from clientId. */
	readonly subject?: string;
	/** Explicitly projected verified tenant boundary. */
	readonly tenantId?: string;
}

/** The only application claims accepted into the token-free runtime principal. */
export interface McpServerPrincipalClaims {
	readonly subject?: string;
	readonly tenantId?: string;
}

/** Maps verified provider-specific token data onto the narrow safe claims surface. */
export type McpServerPrincipalClaimsResolver = (
	authInfo: Readonly<AuthInfo>,
) => MaybePromise<McpServerPrincipalClaims>;
export type McpServerOperationContext = McpOperationContext<McpServerPrincipal>;
export interface McpServerOperationInput {
	readonly request: Request;
	readonly options?: McpHandlerRequestOptions;
}
export type McpServerMiddleware = McpOperationMiddleware<
	McpServerOperationInput,
	Response,
	McpServerOperationContext
>;

export interface McpServerDefinition {
	/** Stable registry name. This may differ from the wire-level server identity. */
	readonly name: string;
	readonly serverInfo: Implementation;
	readonly serverOptions?: ServerOptions;
	readonly features?: readonly McpServerFeature[];
	readonly http?: Omit<CreateMcpHandlerOptions, "onerror">;
	/** Maximum time close waits for accepted wrapper middleware/build work. Defaults to 30 seconds. */
	readonly shutdownTimeoutMs?: number;
	/** Projects verified subject/tenant claims; arbitrary AuthInfo.extra values are never copied. */
	readonly principalClaims?: McpServerPrincipalClaimsResolver;
	/** Request middleware shared by modern and legacy HTTP traffic. */
	readonly middleware?: readonly McpServerMiddleware[];
	/** Payload-safe start/success/failure/cancellation signals for each HTTP exchange. */
	readonly lifecycleObserver?: McpLifecycleObserver<McpServerOperationContext>;
	/** Server-instance construction lifecycle; use `lifecycleObserver` for request telemetry. */
	readonly observer?: McpServerRuntimeObserver;
	readonly onError?: (error: Error) => void;
}

export function defineMcpServer<const DEFINITION extends McpServerDefinition>(
	definition: DEFINITION,
): DEFINITION {
	return definition;
}

export function defineMcpServerFeature(feature: McpServerFeature): McpServerFeature {
	return feature;
}
