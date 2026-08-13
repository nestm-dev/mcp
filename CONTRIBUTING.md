# Contributing

NestM MCP is an ESM-only pnpm workspace targeting Node.js `>=22.13.0`, NestJS 12 alpha, TypeScript 7, and the official MCP TypeScript SDK v2.

## Set up the workspace

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm run check
pnpm run test
pnpm run build
```

Use the exact pnpm version declared in `package.json`. Do not edit the vendored projects under `references/`; they are research inputs and are excluded from published packages.

## Package boundaries

- `mcp-core` must remain free of NestJS and official MCP SDK runtime dependencies.
- `mcp-client` imports client-side official SDK surfaces only.
- `mcp-server` imports server and hosting-adapter surfaces only.
- `mcp-gateway` may compose client and server packages but must not move routing or token policy into core.
- `mcp` owns Nest decorators, discovery, DI, and application lifecycle—not protocol behavior.

Avoid dependency cycles. Internal runtime dependencies use `workspace:^`; official SDK and Nest packages exposed through public APIs remain peer dependencies with exact workspace development pins.

## TypeScript and API style

- Use ESM, named exports, explicit package export maps, and `.ts` extensions for relative source imports.
- Use `import type` where imports are type-only.
- Keep strict TypeScript enabled. Do not introduce `any` to bridge an SDK boundary; validate `unknown` or add a typed adapter.
- Prefer discriminated unions and immutable inputs for public runtime contracts.
- Preserve cancellation signals and primary errors across middleware.
- Keep decorated Nest classes in the Nest package so framework-neutral packages stay portable.
- Add an explicit tsdown entry and package export for every public subpath. Do not rely on deep imports.

Public API changes require tests, documentation, and a Changeset. Consumer-visible behavior pins should compare against literal expected values rather than importing the value being tested.

## Tests

```sh
pnpm run test
pnpm run test:coverage
pnpm run verify:pack
pnpm run verify:attw
```

Tests should be deterministic and avoid external services in the default suite. Prefer official in-process transports or a handler-backed `fetch` for client/server integration tests. Close clients before handlers, registries, or Nest applications so in-flight exchanges cannot leak between tests.

Add coverage at the boundary where behavior is observable:

- core middleware order, re-entry, authorization, cancellation, and observer isolation;
- client connection state, discovery freshness, auth retry, and transport ownership;
- server per-request construction, feature registration, resource authentication, and shutdown;
- gateway routing, name collisions, capability projection, and credential separation;
- Nest discovery, module configuration, provider lifecycles, and Express/Fastify mounting.

Any test that needs Postgres, Redis, a broker, or a live identity provider must live in a separately named opt-in suite and fail clearly when its required environment is selected but unavailable.

## Documentation and security

Update the relevant file under `docs/` whenever a change affects state ownership, auth, middleware order, telemetry fields, or deployment assumptions. Never put real tokens, client secrets, internal URLs, or captured MCP payloads in tests or documentation.

Report vulnerabilities through the process in [SECURITY.md](SECURITY.md), not a public issue.

## Changesets

Add a Changeset for every publishable change:

```sh
pnpm changeset
```

The packages currently release as a fixed alpha group. Choose the smallest semver impact that accurately describes the public change and explain migration requirements in the summary.

## Pull requests

Before requesting review:

1. Run `pnpm run check` and `pnpm run test`.
2. Run `pnpm run verify:pack` for export-map and packed-package validation.
3. Add or update a Changeset.
4. Update documentation and examples.
5. Confirm generated output, coverage, local environment files, and vendored references are not included.
