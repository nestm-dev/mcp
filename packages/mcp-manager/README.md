# `@nestm/mcp-manager`

A framework-neutral, process-local lifecycle manager for dynamic MCP client generations.

It accepts only an opaque generation key and a host-owned resolver that returns already-admitted
transport material. Connection records, endpoints, credentials, tenancy, approval policy, and
persistence remain in the host application.

## Install

```sh
pnpm add @nestm/mcp-manager @nestm/mcp-client @modelcontextprotocol/client
```

## Usage

```ts
import { McpRuntimeManager } from "@nestm/mcp-manager";

const manager = new McpRuntimeManager({
	generationResolver: {
		async resolve(generationKey, signal) {
			const admitted = await resolveAdmittedTransport(generationKey, signal);
			return {
				transport: admitted.transport,
				close: () => admitted.close(),
			};
		},
	},
	maxConnections: 16,
	maxStateEntries: 1_000,
	shutdownTimeoutMs: 30_000,
});

await manager.ensureOnline("opaque-generation-capability");
const catalog = await manager.refreshCatalog("opaque-generation-capability");
await manager.close();
```

`subscribe(listener)` emits key-free, bounded state transitions. Pass an optional
`McpLifecycleObserver` as `observer` to observe operations performed by each managed
`McpClientRuntime`. Runtime server names are random and never derived from the generation key;
telemetry exporters should omit operation targets when aggregating across dynamic generations.

Retained state is bounded by `maxStateEntries` (1,000 by default and always at least
`maxConnections`). Live and quarantined projections are protected; older offline or failed
diagnostics are evicted first. State listeners still receive each bounded transition event even
when its projection cannot be retained.

Cleanup failures quarantine and continue charging the affected generation against the configured
capacity. Runtime cleanup runs before admitted-material cleanup, and both are bounded by
`shutdownTimeoutMs`; a timed-out host `close()` remains quarantined. The manager is in memory only
and implements both `close()` and `AsyncDisposable`.
