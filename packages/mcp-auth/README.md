# @nestm/mcp-auth

Framework-neutral OAuth toolkit for [Model Context Protocol](https://modelcontextprotocol.io) v2
servers. It targets the stateless 2026-07-28 revision and builds on
`@modelcontextprotocol/{client,core,server}` v2 as peer dependencies.

> Alpha. Ships both the resource-server building blocks (Client ID Metadata Document resolution,
> token storage, JWT issuing/verification) and the OAuth 2.1 authorization-server proxy
> (`McpOAuthProxy`: authorize/consent/callback/token with two-tier PKCE, refresh rotation, and
> upstream token swap), durable/encrypted stores, and RFC 8693 token exchange.

## Install

```sh
pnpm add @nestm/mcp-auth@alpha @modelcontextprotocol/client@2 @modelcontextprotocol/core@2 @modelcontextprotocol/server@2
# jose is an optional peer, needed only for createJwksTokenVerifier
pnpm add jose
```

## Exports

| Entry       | Contents                                                                                                  |
| ----------- | --------------------------------------------------------------------------------------------------------- |
| `.`         | JWT key ring + issuer/verifier, proxy and JWKS `OAuthTokenVerifier`s, principal-claims projection, errors |
| `./cimd`    | Client ID Metadata Document resolver and the SSRF-hardened document fetcher                               |
| `./stores`  | `McpOAuthStore` contract and the bounded in-memory implementation                                         |
| `./testing` | An ephemeral signing ring and access-token minter for tests                                               |

`./cimd` and `./stores` never import `@nestm/mcp-server` or `@modelcontextprotocol/server`, so a
gateway or client host can adopt CIMD validation or the storage contract on its own.

## Client ID Metadata Documents

CIMD (SEP-991) replaces Dynamic Client Registration for 2026-07-28. A `client_id` is an HTTPS URL
whose document describes the client. Resolution is strict and SSRF-hardened:

```ts
import { createMcpClientIdMetadataResolver } from "@nestm/mcp-auth/cimd";

const resolver = createMcpClientIdMetadataResolver({
	allowedHosts: [".apps.example.com"], // optional trust policy
	maxDocumentBytes: 8_192,
});

const metadata = await resolver.resolve("https://app.example.com/oauth/client.json");
```

- URL admission (before any network I/O): HTTPS only, path required, no dot-segments/fragment/userinfo,
  no query by default, bounded length, IP-literal and host-allowlist checks.
- The fetcher uses `node:https` with a connection-time `lookup` hook, so the addresses validated are
  exactly the addresses connected to — no DNS-rebinding window, no `undici` dependency. Redirects are
  never followed; loopback, private, link-local (incl. `169.254.169.254`), NAT64, 6to4, and
  IPv4-mapped IPv6 ranges are blocked.
- Successful documents are cached (LRU, TTL clamped, `no-store` honored). Failures are never cached;
  repeated failures open a per-host circuit breaker.

## Tokens

Mint and verify RFC 9068 `at+jwt` access tokens with a key ring. EdDSA is the default so replicas and
resource servers share only a public key:

```ts
import {
	createMcpTokenKeyRing,
	generateMcpSigningKey,
	createMcpProxyTokenVerifier,
} from "@nestm/mcp-auth";

const ring = createMcpTokenKeyRing({ keys: [generateMcpSigningKey("EdDSA")] });
const verifier = createMcpProxyTokenVerifier({
	ring,
	issuer: "https://mcp.example.com",
	resources: ["https://mcp.example.com/mcp"],
});
```

`verifier` satisfies the SDK `OAuthTokenVerifier` contract, so it drops straight into
`McpResourceServer` (or the Nest `oauth.resource` group). The verifier pins the signature algorithm
from the resolved key — never the token header — and projects only allowlisted `{sub, tid}` claims.

For servers fronting an external authorization server, `createJwksTokenVerifier` validates tokens
against a remote JWKS (requires `jose`).

## Storage

`McpOAuthStore` is a bounded, TTL-first contract that maps one-to-one onto Redis primitives
(`GET`/`SET EX`/`SET NX EX`/`GETDEL`/`DEL`) with no scan operations, so a distributed adapter needs
no API change. Implementations compose:

- `McpMemoryOAuthStore` — bounded in-memory; rejects writes at capacity rather than evicting live records.
- `McpDiskOAuthStore` — single-node filesystem persistence with an atomic, cross-process `take`.
- `withEncryptedValues(store, { keys })` — AES-256-GCM at rest with key rotation; the AEAD binds each
  ciphertext to its key id and storage key so records cannot be relocated.

```ts
import { McpDiskOAuthStore, withEncryptedValues } from "@nestm/mcp-auth/stores";

const store = withEncryptedValues(new McpDiskOAuthStore({ directory: "/var/lib/mcp-oauth" }), {
	keys: [{ id: "2026-02", secret: process.env.OAUTH_STORE_KEY! }],
});
```

## Authorization-server proxy

`McpOAuthProxy` fronts a real upstream IdP, holding upstream tokens server-side and minting its own
audience-scoped access tokens. The upstream leg reuses the official `@modelcontextprotocol/client`
OAuth helpers (discovery, PKCE, RFC 9207 `iss` validation) through `McpUpstreamAdapter`; provider
presets (`googleUpstream`, `githubUpstream`, `azureUpstream`, `genericUpstream`) supply the issuer,
scopes, and quirks. Compose it as a fetch facade with `McpOAuthServer`, or serve it in NestJS via
`McpOAuthControllerFor` and the `oauth.proxy` option group. See `docs/security-and-oauth.md` for the
threat model and the invariants it enforces.

## NestJS

The `@nestm/mcp` adapter consumes this package through the per-server `oauth` option group
(`oauth.resource` for resource-server protection, `oauth.proxy` for the authorization-server proxy).
See `@nestm/mcp` and `docs/security-and-oauth.md`.
