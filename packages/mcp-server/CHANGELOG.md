# @nestm/mcp-server

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

### Patch Changes

- @nestm/mcp-core@0.1.0-alpha.1

## 0.1.0-alpha.0

### Minor Changes

- Bootstrap the NestM MCP v2 runtime, client, server, observability, gateway, and NestJS module packages.

### Patch Changes

- Updated dependencies
  - @nestm/mcp-core@0.1.0-alpha.0
