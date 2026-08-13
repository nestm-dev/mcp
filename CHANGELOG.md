# Changelog

All notable changes to this project will be documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and releases follow Semantic Versioning after accounting for the additional instability of alpha versions.

## [Unreleased]

### Added

- Initial pnpm monorepo and fixed-group Changesets release configuration.
- Framework-neutral operation middleware, fail-closed authorization, and lifecycle observation in `@nestm/mcp-core`.
- Multi-server official v2 client runtime with typed general requests, manual modern `input_required` rounds, completion, managed modern subscriptions, and explicit legacy subscription delegates in `@nestm/mcp-client`.
- Stateless per-request server runtime and OAuth resource-server composition in `@nestm/mcp-server`.
- Policy-enforced tool, prompt, concrete-resource, resource-template, and completion aggregation with reversible routing, authorization-scoped discovery caching, and first-party client-runtime composition in `@nestm/mcp-gateway`.
- Backend-neutral bounded logging, metrics, tracing, attribute projection, and redaction adapters in `@nestm/mcp-observability`.
- NestJS 12 module, decorator discovery, named multi-server client integration, and application lifecycle in `@nestm/mcp`.
- First-class Nest aggregate gateway definitions backed by module-owned named clients, with bootstrap-time reference validation, operational lookup, dependency-ordered shutdown, and lifecycle-safe cleanup error reporting.
- Validated Nest handler authorization, middleware, and lifecycle pipelines shared by decorated HTTP and stdio callbacks.
- Async injected Nest module configuration, local-module mode, and rollback of partially initialized runtimes after bootstrap failure.
- Architecture, security/OAuth, observability, contribution, and repository security documentation.
- Node 22/24 CI for checks, tests, builds, and package publication validation.

### Planned

- Vendor-specific OpenTelemetry bindings, distributed event-bus and cache implementations, persistent OAuth token stores, token exchange, and external policy-engine adapters.

## [0.1.0-alpha.0] - Unreleased

Initial alpha bootstrap. This version has not been declared stable and may receive breaking API changes before publication.
