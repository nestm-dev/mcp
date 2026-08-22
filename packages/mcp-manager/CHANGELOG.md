# @nestm/mcp-manager

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
