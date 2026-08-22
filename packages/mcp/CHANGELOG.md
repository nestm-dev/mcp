# @nestm/mcp

## 0.1.0-alpha.4

### Minor Changes

- bcbe893: Add process-local dynamic gateway topology with revision-fenced attach, detach, and atomic replace
  operations. Dynamic gateways advertise list-change support from an empty topology while retaining
  collision-free tool, prompt, resource, and resource-template routing.
- bcbe893: Add a published, framework-neutral manager for bounded dynamic MCP client generations, including
  deterministic draining, cleanup quarantine, key-free state lifecycle subscriptions, catalog and
  operation delegation, a lease-scoped client-runtime integration callback, and optional lifecycle
  observation for every managed client runtime.

  Expose a thin Nest adapter at `@nestm/mcp/manager` with synchronous and asynchronous module
  configuration, provider-token generation resolvers and observers, an injectable manager service,
  and deterministic module shutdown.

### Patch Changes

- Updated dependencies [bcbe893]
- Updated dependencies [bcbe893]
  - @nestm/mcp-gateway@0.1.0-alpha.4
  - @nestm/mcp-manager@0.1.0-alpha.4
  - @nestm/mcp-core@0.1.0-alpha.4
  - @nestm/mcp-client@0.1.0-alpha.4
  - @nestm/mcp-server@0.1.0-alpha.4
  - @nestm/mcp-auth@0.1.0-alpha.4

## 0.1.0-alpha.3

### Patch Changes

- 758c3a3: Declare `@nestm/mcp-auth` as a runtime dependency so production installs can import the built Nest
  module's OAuth integration without relying on development dependencies. Add a first-class
  `@nestm/mcp/client` entrypoint for outbound-only Nest applications without loading inbound server,
  gateway, or OAuth implementation code.
- Updated dependencies [758c3a3]
- Updated dependencies [bd245f5]
  - @nestm/mcp-client@0.1.0-alpha.3
  - @nestm/mcp-core@0.1.0-alpha.3
  - @nestm/mcp-server@0.1.0-alpha.3
  - @nestm/mcp-auth@0.1.0-alpha.3
  - @nestm/mcp-gateway@0.1.0-alpha.3

## 0.1.0-alpha.2

### Minor Changes

- 71500ba: **Breaking default:** MCP HTTP serving now applies a fail-closed security posture. Browser requests
  from routable origins are rejected until their hostnames are listed in
  `httpSecurity.allowedOriginHostnames` (requests without an `Origin` header are unaffected); opt out
  entirely with `allowedOriginHostnames: false`. Request bodies are capped at 1 MiB by default
  (`maxBodyBytes`), enforced on the raw Node stream before the SDK buffers it and again at the fetch
  layer.

  Added MCP-aware CORS: the 2026-07-28 revision's `Mcp-Method`/`Mcp-Name` headers make every browser
  MCP POST CORS-preflighted, and the SDK handler answers preflights with 405 — the runtime now
  answers them for allowed origins and decorates responses. `@nestm/mcp-server/security` gains
  `resolveMcpHttpSecurity`, `hardenMcpFetch`, `McpHardenedServer`, `withMcpNodeBodyLimit`, and the
  `MCP_CORS_*` header constants; runtime observers see pre-dispatch rejections as `request:rejected`
  events. `@nestm/mcp` adds `mcpCorsOptions()` for `app.enableCors()` and a
  `getHttpSecurityOptions()` controller override that replaces the runtime posture for one route.

- 48ae661: Add a standalone Nest-owned `McpClientModule` and injectable `McpClientService` with synchronous
  and asynchronous configuration, module-local collaborators, optional `bootstrap.connectAll`
  connection, failed bootstrap rollback, and deterministic shutdown. The framework-neutral
  `McpClientRuntime` remains directly constructible from `@nestm/mcp-client`.

  Compose outbound clients into `McpModule` through Nest module imports instead of embedding raw
  client runtime options in the inbound server root. Resolve callback-bearing client, gateway, and
  server collaborators from explicit singleton provider tokens, including transport/auth factories,
  middleware and lifecycle observers, gateway codecs and caches, request-state verification, JSON
  schema validators, and distributed server event buses. Context-aware gateway upstream selection is
  now supplied by an injectable `McpGatewayClientProvider`; raw structural upstreams remain available
  only from the framework-neutral gateway package. The neutral client's default implementation
  identity now derives its version from package metadata so prerelease bumps cannot drift. Provider
  binding also preserves client and gateway exact-transform identity and its typed continuation
  guarantees.

  `McpHttpControllerFor()` now accepts only the server name. Compose HTTP wrappers and Node-adapter
  error reporting through the controller's protected overrides so those paths can use injected Nest
  providers instead of factory-captured callbacks. Nest client configuration no longer accepts a raw
  singleton `runtime.principal`; use the provider-backed `principalResolver` seam.

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

### Patch Changes

- Updated dependencies [71500ba]
- Updated dependencies [48ae661]
- Updated dependencies [dcdcbb0]
  - @nestm/mcp-server@0.1.0-alpha.2
  - @nestm/mcp-client@0.1.0-alpha.2
  - @nestm/mcp-gateway@0.1.0-alpha.2
  - @nestm/mcp-core@0.1.0-alpha.2

## 0.1.0-alpha.1

### Minor Changes

- bea06c1: Narrow the Nest integration to a Nest-native public surface and remove redundant construction
  aliases across the lower runtimes.

  `@nestm/mcp` now exports its module, decorators, application services, Nest configuration types,
  and a deliberately small set of callback helpers instead of mirroring every core, client, server,
  gateway, and observability export. Import framework-neutral APIs from their owning packages.
  `McpModule` is local by default, ordinary Nest modules replace `forFeature()`, low-level server
  registration uses injectable contributors, server collaborators are configured through provider
  tokens, catalog and gateway policies are singleton Nest providers, and internal registries/options
  tokens are no longer public application services. A second configured root fails bootstrap; put all
  clients and servers in the application's single shared root. Use `McpCapabilitiesService` for supported live
  capability registration. Collaborators are explicitly registered under `McpModule` so Nest module
  isolation and lifecycle ordering are preserved.

  Remove the no-op `defineMcpServer`, `defineMcpServerFeature`, and
  `defineMcpCatalogExposureResolver` helpers; use contextual typing or `satisfies` instead. Remove
  the redundant `createMcpGateway`, `createMcpGatewayFeature`, and
  `createDefaultMcpClientTransportFactory` factories; construct `McpGateway` directly and use the
  shared default client transport factory. Remove `withMcpBearerAuth` and
  `withMcpRequestValidation`; construct `McpResourceServer` and `McpValidatedServer` directly.

- 367d66b: Rename the Nest capability decorators to `Tool`, `Prompt`, `Resource`, and `Targets`, and remove the redundant `Mcp` prefix from their option, definition, and method-decorator types. Module, runtime, and protocol-level names remain MCP-qualified.
- 11d149e: Export official discovered MCP tool schema types and a dependency-neutral, AJV-validated Standard Schema adapter for dynamic tool consumers.
- a9984a8: Add authorization-safe per-request tool catalog exposure for Nest servers and exact method- or
  operation-specific transform helpers for client and gateway middleware. Manual input-required
  client calls now expose their continuation result in method-keyed and high-level return types.

### Patch Changes

- Updated dependencies [bea06c1]
- Updated dependencies [11d149e]
- Updated dependencies [a9984a8]
  - @nestm/mcp-client@0.1.0-alpha.1
  - @nestm/mcp-server@0.1.0-alpha.1
  - @nestm/mcp-gateway@0.1.0-alpha.1
  - @nestm/mcp-core@0.1.0-alpha.1

## 0.1.0-alpha.0

### Minor Changes

- Bootstrap the NestM MCP v2 runtime, client, server, observability, gateway, and NestJS module packages.

### Patch Changes

- Updated dependencies
  - @nestm/mcp-core@0.1.0-alpha.0
  - @nestm/mcp-client@0.1.0-alpha.0
  - @nestm/mcp-server@0.1.0-alpha.0
  - @nestm/mcp-observability@0.1.0-alpha.0
  - @nestm/mcp-gateway@0.1.0-alpha.0
