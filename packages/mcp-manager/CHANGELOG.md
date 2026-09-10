# @nestm/mcp-manager

## 0.1.0-alpha.24

### Patch Changes

- 71d65cf: Expose an awaited admitted-generation onConnected hook with the immutable negotiated state so hosts can retain connection observations without extending runtime leases or probing twice.
- @nestm/mcp-client@0.1.0-alpha.24
  - @nestm/mcp-core@0.1.0-alpha.24

## 0.1.0-alpha.23

### Patch Changes

- Updated dependencies [b207d20]
  - @nestm/mcp-client@0.1.0-alpha.23
  - @nestm/mcp-core@0.1.0-alpha.23

## 0.1.0-alpha.22

### Patch Changes

- @nestm/mcp-client@0.1.0-alpha.22
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

- Updated dependencies [54e5136]
  - @nestm/mcp-client@0.1.0-alpha.21
  - @nestm/mcp-core@0.1.0-alpha.21

## 0.1.0-alpha.20

### Patch Changes

- Updated dependencies [24646ad]
  - @nestm/mcp-client@0.1.0-alpha.20
  - @nestm/mcp-core@0.1.0-alpha.20

## 0.1.0-alpha.19

### Patch Changes

- Updated dependencies [54ef651]
  - @nestm/mcp-client@0.1.0-alpha.19
  - @nestm/mcp-core@0.1.0-alpha.19

## 0.1.0-alpha.18

### Patch Changes

- @nestm/mcp-client@0.1.0-alpha.18
  - @nestm/mcp-core@0.1.0-alpha.18

## 0.1.0-alpha.17

### Patch Changes

- Updated dependencies [d0a2dd3]
  - @nestm/mcp-client@0.1.0-alpha.17
  - @nestm/mcp-core@0.1.0-alpha.17

## 0.1.0-alpha.16

### Patch Changes

- Updated dependencies [31b41a3]
  - @nestm/mcp-client@0.1.0-alpha.16
  - @nestm/mcp-core@0.1.0-alpha.16

## 0.1.0-alpha.15

### Patch Changes

- Updated dependencies [7346f94]
  - @nestm/mcp-client@0.1.0-alpha.15
  - @nestm/mcp-core@0.1.0-alpha.15

## 0.1.0-alpha.14

### Patch Changes

- Updated dependencies [9c05d22]
  - @nestm/mcp-client@0.1.0-alpha.14
  - @nestm/mcp-core@0.1.0-alpha.14

## 0.1.0-alpha.13

### Patch Changes

- Updated dependencies [f546bf3]
  - @nestm/mcp-client@0.1.0-alpha.13
  - @nestm/mcp-core@0.1.0-alpha.13

## 0.1.0-alpha.12

### Patch Changes

- Updated dependencies [007763e]
  - @nestm/mcp-client@0.1.0-alpha.12
  - @nestm/mcp-core@0.1.0-alpha.12

## 0.1.0-alpha.11

### Minor Changes

- bdee920: Add an explicit exclusive operation lease mode for non-pooled, close-before-settlement managed MCP
  runtimes, including same-generation conflict fencing and retirement coverage. Shared catalog refresh
  now waits for every parallel discovery request before releasing its lease, while exclusive refresh
  serializes those requests for minimal OAuth providers. The public docs identify `refreshCatalog`
  plus `digestMcpRuntimeCatalog` as the generic freshness/change boundary.

### Patch Changes

- @nestm/mcp-client@0.1.0-alpha.11
  - @nestm/mcp-core@0.1.0-alpha.11

## 0.1.0-alpha.10

### Minor Changes

- cb14f77: Add `McpRuntimeOwnership`, a framework-neutral bounded coordinator for shared opaque runtime
  generations. Cooperative final release, force-retirement fencing, manager-retirement barriers,
  idempotent owner settlement, manager-close handling, aggregate cleanup failures, and key-free
  snapshots and errors let hosts delete projection-ownership bookkeeping without moving durable state
  or product policy into the SDK.

### Patch Changes

- @nestm/mcp-client@0.1.0-alpha.10
  - @nestm/mcp-core@0.1.0-alpha.10

## 0.1.0-alpha.9

### Patch Changes

- @nestm/mcp-client@0.1.0-alpha.9
  - @nestm/mcp-core@0.1.0-alpha.9

## 0.1.0-alpha.8

### Patch Changes

- @nestm/mcp-client@0.1.0-alpha.8
  - @nestm/mcp-core@0.1.0-alpha.8

## 0.1.0-alpha.7

### Minor Changes

- eb921e7: Publish `MCP_RUNTIME_PHASES` and `MCP_RUNTIME_PROTOCOL_ERAS` as frozen tuples that mirror the
  `McpRuntimePhase` and `McpRuntimeProtocolEra` unions through a compile-time exhaustiveness fence,
  together with `mcpRuntimeStateSnapshotSchema`, `mcpRuntimeProbeSnapshotSchema`, and
  `mcpRuntimeCapabilitiesSnapshotSchema`. The validators implement Standard Schema v1 without adding
  a runtime dependency: they accept exactly what the manager emits, reject unknown properties and
  unpublished phases, eras, or state error codes, and return a frozen normalized snapshot so hosts
  can validate persisted projections on the way back in.

  Accept an `McpRuntimeToolCallOptions` object as the fourth `callTool` argument. A positional
  `AbortSignal` stays source compatible as the cancellation-only form, and pinning `toolDefinition`
  threads that exact definition to the managed client runtime so structured output is validated
  against it instead of a cached `tools/list` view. `McpManagerService` from `@nestm/mcp/manager`
  inherits the widened call surface.

### Patch Changes

- @nestm/mcp-core@0.1.0-alpha.7
- @nestm/mcp-client@0.1.0-alpha.7

## 0.1.0-alpha.6

### Patch Changes

- @nestm/mcp-core@0.1.0-alpha.6
- @nestm/mcp-client@0.1.0-alpha.6

## 0.1.0-alpha.5

### Patch Changes

- @nestm/mcp-core@0.1.0-alpha.5
- @nestm/mcp-client@0.1.0-alpha.5

## 0.1.0-alpha.4

### Minor Changes

- bcbe893: Add a published, framework-neutral manager for bounded dynamic MCP client generations, including
  deterministic draining, cleanup quarantine, key-free state lifecycle subscriptions, catalog and
  operation delegation, a lease-scoped client-runtime integration callback, and optional lifecycle
  observation for every managed client runtime.

  Expose a thin Nest adapter at `@nestm/mcp/manager` with synchronous and asynchronous module
  configuration, provider-token generation resolvers and observers, an injectable manager service,
  and deterministic module shutdown.

### Patch Changes

- @nestm/mcp-core@0.1.0-alpha.4
- @nestm/mcp-client@0.1.0-alpha.4

## 0.1.0-alpha.2

### Minor Changes

- Add a framework-neutral, bounded runtime-generation manager with deterministic draining,
  quarantine semantics, catalog and operation delegation, key-free state lifecycle events, and
  optional client lifecycle observation. Retained state and admitted-material cleanup are bounded,
  and same-generation online/offline transitions are fenced against concurrent lifecycle work.
