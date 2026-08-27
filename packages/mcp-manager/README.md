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

`callTool(generationKey, name, arguments, options)` accepts either a positional `AbortSignal` or an
`McpRuntimeToolCallOptions` object. Pinning `toolDefinition` keeps the managed client runtime's
structured output validation bound to that exact definition instead of its cached `tools/list`
view, so a host that already holds an approved definition never validates a result against a
drifted schema.

Retained state is bounded by `maxStateEntries` (1,000 by default and always at least
`maxConnections`). Live and quarantined projections are protected; older offline or failed
diagnostics are evicted first. State listeners still receive each bounded transition event even
when its projection cannot be retained.

`MCP_RUNTIME_PHASES` and `MCP_RUNTIME_PROTOCOL_ERAS` publish every lifecycle phase and negotiated
protocol era as frozen tuples for hosts that persist state projections. The matching
`mcpRuntimeStateSnapshotSchema`, `mcpRuntimeProbeSnapshotSchema`, and
`mcpRuntimeCapabilitiesSnapshotSchema` validators implement [Standard
Schema](https://standardschema.dev) v1 with no added runtime dependency: they accept exactly what
the manager emits, reject unknown properties, and return a frozen normalized snapshot.

Cleanup failures quarantine and continue charging the affected generation against the configured
capacity. Runtime cleanup runs before admitted-material cleanup, and both are bounded by
`shutdownTimeoutMs`; a timed-out host `close()` remains quarantined. The manager is in memory only
and implements both `close()` and `AsyncDisposable`.
