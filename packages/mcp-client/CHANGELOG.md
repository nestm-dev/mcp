# @nestm/mcp-client

## 0.1.0-alpha.11

### Patch Changes

- @nestm/mcp-core@0.1.0-alpha.11

## 0.1.0-alpha.10

### Patch Changes

- @nestm/mcp-core@0.1.0-alpha.10

## 0.1.0-alpha.9

### Patch Changes

- @nestm/mcp-core@0.1.0-alpha.9

## 0.1.0-alpha.8

### Patch Changes

- @nestm/mcp-core@0.1.0-alpha.8

## 0.1.0-alpha.7

### Patch Changes

- @nestm/mcp-core@0.1.0-alpha.7

## 0.1.0-alpha.6

### Patch Changes

- @nestm/mcp-core@0.1.0-alpha.6

## 0.1.0-alpha.5

### Patch Changes

- @nestm/mcp-core@0.1.0-alpha.5

## 0.1.0-alpha.4

### Patch Changes

- @nestm/mcp-core@0.1.0-alpha.4

## 0.1.0-alpha.3

### Minor Changes

- 758c3a3: Add a bounded, framework-neutral `McpClientLeaseManager` for opaque, non-secret identity keys. It
  deduplicates concurrent resource creation, maintains active reference counts, drains retired
  generations safely, supports explicit idle reuse, and defaults every resource to close on final
  release.
- bd245f5: Add a dedicated `@nestm/mcp-client/oauth` surface for strict, host-managed outbound OAuth. It
  provides exact resource and issuer discovery, mandatory endpoint policy checks, PKCE and
  digest-only state transactions, pre-registered client authentication, revisioned credential CAS,
  durable pre-dispatch refresh claims, bounded refresh coordination, invalidation hooks for runtime
  lease eviction, and a per-binding minimal transport provider without implicit redirects or Dynamic
  Client Registration.

### Patch Changes

- @nestm/mcp-core@0.1.0-alpha.3

## 0.1.0-alpha.2

### Patch Changes

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

- 11d149e: Export official discovered MCP tool schema types and a dependency-neutral, AJV-validated Standard Schema adapter for dynamic tool consumers.
- a9984a8: Add authorization-safe per-request tool catalog exposure for Nest servers and exact method- or
  operation-specific transform helpers for client and gateway middleware. Manual input-required
  client calls now expose their continuation result in method-keyed and high-level return types.

### Patch Changes

- @nestm/mcp-core@0.1.0-alpha.1

## 0.1.0-alpha.0

### Minor Changes

- Bootstrap the NestM MCP v2 runtime, client, server, observability, gateway, and NestJS module packages.

### Patch Changes

- Updated dependencies
  - @nestm/mcp-core@0.1.0-alpha.0
