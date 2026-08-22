import type { AuthProvider, FetchLike } from "@modelcontextprotocol/client";

export type OAuthConnectionStatus =
	"authorization-required" | "authorizing" | "authorized" | "reauthorization-required" | "failed";

export interface OAuthConnectionView {
	readonly kind: "oauth";
	readonly status: OAuthConnectionStatus;
	readonly scopes: readonly string[];
	readonly authorizationServerHost?: string;
	readonly errorCode?: string;
}

export interface OAuthRuntimeBridgeLease {
	readonly authProvider: AuthProvider;
	close(): Promise<void>;
}

export interface OAuthCallbackOutcome {
	readonly oauth: "authorized" | "failed";
	readonly connectionId?: string;
	readonly code?: string;
}

export const MCP_OAUTH_BASE_FETCH = Symbol("example-mcp-control-plane:oauth-base-fetch");
export type McpOAuthBaseFetch = FetchLike;
