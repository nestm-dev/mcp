# @nestm/mcp-auth

## 0.1.0-alpha.2

### Minor Changes

- dcdcbb0: Add `@nestm/mcp-auth`, a framework-neutral OAuth toolkit for MCP resource servers, and wire it into
  the Nest adapter through a per-server `oauth` option group (Phase 1 of the authorization-server
  proxy roadmap).

  - **`@nestm/mcp-auth`**: Client ID Metadata Document resolution (SEP-991) with strict URL admission,
    document validation against `@modelcontextprotocol/core` schemas, and an SSRF-hardened `node:https`
    fetcher that pins DNS at connect time (no `undici` dependency); a bounded, TTL-first
    `McpOAuthStore` contract that maps onto Redis primitives, plus a capacity-rejecting in-memory
    implementation; an asymmetric-by-default (EdDSA/ES256, HS256 for dev) JWT key ring, issuer, and
    verifier with JWKS publication and algorithm pinning; `createMcpProxyTokenVerifier` and
    `createJwksTokenVerifier` (`OAuthTokenVerifier`); and a token-free principal-claims projection.
    Subpaths `./cimd`, `./stores`, and `./testing`; `jose` is an optional peer needed only for JWKS
    verification.
  - **`@nestm/mcp-server`**: `McpResourceServer` gains an optional fail-closed `anonymous` policy,
    consulted only after bearer verification refuses a request.
  - **`@nestm/mcp`**: `McpNestServerDefinition.oauth.resource` composes `McpResourceServer` bearer
    verification and RFC 9728/8414 metadata around the HTTP handler using injected provider tokens
    (`verifier`, optional `anonymous`), exposed via `McpRuntimeService.composeHttpHandler()` and the
    HTTP controller's default composition seam.

  Adds the OAuth 2.1 **authorization-server proxy** in front of a real upstream IdP: `@nestm/mcp-auth`
  gains `McpOAuthProxy` (authorize → consent → callback → token, refresh rotation with reuse
  detection, two-tier PKCE, RFC 8707 resource binding, RFC 9207 `iss` validation via the client SDK),
  `createMcpOAuthRouter`, `McpOAuthServer`, `McpUpstreamAdapter` over the official client OAuth
  helpers, provider presets (`googleUpstream`/`githubUpstream`/`azureUpstream`/`genericUpstream`), a
  bounded `McpMemoryOAuthStore`, and an SSRF-guarded `createSsrfGuardedFetch`. `@nestm/mcp` adds the
  `oauth.proxy` option group (all extensibility via provider tokens — no key material in options),
  `McpOAuthControllerFor` (explicit per-endpoint routes, dispatch by handler identity), and
  `McpOAuthService.upstreamTokens()` for gateway user-delegation. The proxy holds upstream tokens
  server-side and mints its own EdDSA/ES256 access tokens, so the downstream MCP client never receives
  an upstream credential. Adversarially reviewed (56-agent workflow); all confirmed findings fixed
  before merge.

- dcdcbb0: Add durable/encrypted OAuth storage and RFC 8693 token exchange to the authorization-server proxy.

  - **Encrypted store decorator** (`withEncryptedValues`): AES-256-GCM at rest with a 12-byte IV and an
    AEAD binding of `version|keyId|storageKey`, so a record cannot be relocated to a different key or
    storage slot. Multi-key rotation (first key writes, all decrypt); an unknown key id or failed tag
    surfaces as a missing record — never plaintext, never a thrown error.
  - **Disk store** (`McpDiskOAuthStore`): single-node filesystem persistence with per-record TTL,
    atomic writes, a cross-process atomic `take` via `rename`, path-traversal- and collision-safe key
    hashing, and a `sweep()` maintenance pass. Compose it under `withEncryptedValues` for
    confidentiality at rest.
  - **RFC 8693 token exchange**: `McpOAuthProxy` handles
    `grant_type=urn:ietf:params:oauth:grant-type:token-exchange` as its own STS — a confidential,
    authenticated client exchanges a proxy-minted `subject_token` for a new access token scoped to a
    configured `resource` with a subset of the grant's scopes (no refresh token). Advertised in
    authorization-server metadata.

  Retires the "persistent OAuth token stores" and "token exchange" items from the CHANGELOG roadmap.
  Adversarially reviewed (18 confirmed findings, incl. a disk `setIfAbsent` race, a token-exchange
  scope re-widening, and an exchange-chain lifetime extension); all fixed before merge — the disk store
  now serializes same-key writers and uses `link`-based creation, encrypted values pin a 128-bit auth
  tag and offer a fail-closed `strict` mode, and exchange binds scope to the presented token, clamps
  the issued token's lifetime to the subject token's, and keeps the target within the grant's resource.

### Patch Changes

- Updated dependencies [71500ba]
- Updated dependencies [dcdcbb0]
  - @nestm/mcp-server@0.1.0-alpha.2
  - @nestm/mcp-core@0.1.0-alpha.2
