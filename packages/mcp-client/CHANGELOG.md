# @nestm/mcp-client

## 0.1.0-alpha.23

### Minor Changes

- b207d20: Add passive MCP authentication detection over host-admitted fetch. Validate anonymous modern discovery or a complete legacy handshake through the official SDK, or require validated OAuth bootstrap evidence after an authorization denial. Keep unsupported authentication, unreachable endpoints, invalid responses, and failed metadata discovery indeterminate. Bound streaming response reads, deadlines, and legacy session cleanup without performing registration, token acquisition, or feature invocation.

  Hosts may supply a separate guarded OAuth metadata fetch while retaining endpoint-only admission for MCP traffic. Existing challenge probing and OAuth enrollment APIs are unchanged.

### Patch Changes

- @nestm/mcp-conformance@0.1.0-alpha.23
  - @nestm/mcp-core@0.1.0-alpha.23

## 0.1.0-alpha.22

### Patch Changes

- @nestm/mcp-conformance@0.1.0-alpha.22
  - @nestm/mcp-core@0.1.0-alpha.22

## 0.1.0-alpha.21

### Minor Changes

- 54e5136: Add opt-in bounded FIFO admission for exclusive operations with `exclusiveContention: "queue"`.
  Concurrent callers each acquire fresh admitted transport material after prior cleanup, while the
  existing exclusive default remains fail-fast. Queue waiting shares the request deadline, respects
  caller cancellation, and is fenced by retirement, shutdown, and cleanup quarantine. Expose a global
  `maxQueuedOperations` bound and key-free queue diagnostics.

  Add `awaitCleanupOnCancel` to client lease acquisition. Exclusive manager operations select it so
  cancellation during acquisition drains their abandoned material before a queued operation starts;
  ordinary client acquisitions retain immediate, caller-local cancellation by default.

### Patch Changes

- @nestm/mcp-conformance@0.1.0-alpha.21
  - @nestm/mcp-core@0.1.0-alpha.21

## 0.1.0-alpha.20

### Minor Changes

- 24646ad: Add a pure OAuth provisioning planner over captured discovery, public client provenance, and explicit host strategy order, plus a bounded challenge probe over host-admitted fetch. Hosts retain credential custody, browser consent, endpoint admission, atomic state transitions, and registration dispatch fences.

  Expose configurable duration histogram arithmetic with JSON-safe, geometry-checked snapshots and lossless sufficient-statistic merging. The fixed-memory collector now shares this arithmetic with durable consumers without selecting their persistence, dimensions, or telemetry policy.

### Patch Changes

- @nestm/mcp-conformance@0.1.0-alpha.20
  - @nestm/mcp-core@0.1.0-alpha.20

## 0.1.0-alpha.19

### Patch Changes

- 54ef651: Add the optional AI SDK tool adapter for sanitized descriptors and host-protected invocation, preserving exact names, inputs and cancellation without adding AI to core consumers.
- @nestm/mcp-conformance@0.1.0-alpha.19
  - @nestm/mcp-core@0.1.0-alpha.19

## 0.1.0-alpha.18

### Patch Changes

- Updated dependencies [b4c4652]
  - @nestm/mcp-conformance@0.1.0-alpha.18
  - @nestm/mcp-core@0.1.0-alpha.18

## 0.1.0-alpha.17

### Minor Changes

- d0a2dd3: Add bounded OAuth storage snapshot parsers, passive catalog inspection, and exact tool catalog preparation so hosts can consume shared MCP mechanics without reimplementing them.

  The client OAuth surface parses authorities, authorization transactions (including authority-digest verification), and bootstrap discovery results as detached immutable values. Parsing performs no network I/O and does not replace host endpoint admission, credential encryption, callback/session binding, expiry, or atomic transaction consumption.

  The client provides fresh bounded raw discovery on an already acquired runtime and a per-run inspection target. Conformance provides seven passive discovery checks, ambiguity-first tool selection, exact definition capture, and domain-separated input/output schema identities. The conformance kernel remains independent of the SDK, client, manager, Nest, and product state; the client reuses its existing bounded capture implementation.

  Manager refresh retains official SDK aggregation, cache population, and protocol filtering. Passive inspection intentionally inspects raw definitions and does not populate that execution cache.

### Patch Changes

- Updated dependencies [d0a2dd3]
  - @nestm/mcp-conformance@0.1.0-alpha.17
  - @nestm/mcp-core@0.1.0-alpha.17

## 0.1.0-alpha.16

### Patch Changes

- 31b41a3: Allow native OAuth clients to use RFC 8252 loopback HTTP redirect URIs throughout authorization and token exchange while continuing to reject non-loopback HTTP callbacks.
- @nestm/mcp-core@0.1.0-alpha.16

## 0.1.0-alpha.15

### Patch Changes

- 7346f94: Accept successful legacy dynamic-registration responses that follow the MCP SDK schema while still rejecting conflicting security-sensitive metadata.
- @nestm/mcp-core@0.1.0-alpha.15

## 0.1.0-alpha.14

### Patch Changes

- 9c05d22: Accept OAuth authorization servers that do not advertise RFC 9207 response issuer support. The
  callback still requires an exact `iss` when support is advertised and rejects every mismatched
  `iss` value when one is returned.
- @nestm/mcp-core@0.1.0-alpha.14

## 0.1.0-alpha.13

### Patch Changes

- f546bf3: Enforce the RFC 6749 ASCII NQCHAR grammar for configured, discovered, registered, and returned
  OAuth scope tokens, while preserving valid punctuation such as commas. Token exchange now retains
  the pinned requested scope when the response omits it; refresh can retain a caller-supplied current
  scope, and both flows reject an explicit scope that widens the bound grant.
- @nestm/mcp-core@0.1.0-alpha.13

## 0.1.0-alpha.12

### Minor Changes

- 007763e: Add a host-managed OAuth bootstrap that parses bounded Bearer challenges, discovers
  protected-resource and authorization-server metadata, returns explicit issuer-selection and
  strict-compatibility results, honors challenged scope priority, and exposes CIMD and legacy DCR
  capabilities without performing registration. Add an explicit dynamic-registration compatibility
  subpath that performs one policy-approved public-client registration POST without retries or host
  state.

### Patch Changes

- @nestm/mcp-core@0.1.0-alpha.12

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
