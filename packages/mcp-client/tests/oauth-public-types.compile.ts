import type {
	AuthProvider,
	FetchLike,
	McpClientOAuthAuthProvider,
	OAuthTokens,
} from "@nestm/mcp-client/oauth";
import {
	McpClientOAuthProtocol,
	McpClientOAuthProtocolError,
	createMcpClientOAuthCredentialRevision,
	createOAuthStateLookupDigest,
} from "@nestm/mcp-client/oauth";

// @ts-expect-error The strict OAuth subpath never exposes the SDK's implicit interactive provider.
import type { OAuthClientProvider } from "@nestm/mcp-client/oauth";
// @ts-expect-error The strict OAuth subpath has no full-flow orchestrator or Dynamic Registration.
import { auth, registerClient } from "@nestm/mcp-client/oauth";

declare const guardedFetch: FetchLike;

const protocol = new McpClientOAuthProtocol({
	fetch: guardedFetch,
	endpointPolicy() {
		return true;
	},
});

const revision = createMcpClientOAuthCredentialRevision(1);
const digest: string = createOAuthStateLookupDigest("A".repeat(43));
declare const tokens: OAuthTokens;
declare const transportProvider: McpClientOAuthAuthProvider<string, { readonly token: string }>;
const officialMinimalProvider: AuthProvider = transportProvider;

void protocol;
void revision;
void digest;
void tokens.access_token;
void officialMinimalProvider;
void McpClientOAuthProtocolError;

export type StrictSurfaceDoesNotExposeOAuthClientProvider = OAuthClientProvider;
void auth;
void registerClient;
