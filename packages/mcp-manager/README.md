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

## Shared runtime ownership

Use `McpRuntimeOwnership` when several host projections can retain the same opaque manager
generation. It composes the manager's existing `retire()` port without taking over product records,
key construction, admission, tenancy, or persistence:

```ts
import { McpRuntimeManager, McpRuntimeOwnership } from "@nestm/mcp-manager";

const manager = new McpRuntimeManager({
	generationResolver,
	maxConnections: 16,
});
const ownership = new McpRuntimeOwnership({
	manager,
	maxOwners: 1_000,
	maxGenerations: 1_000,
	maxReferences: 10_000,
});

const workspaceProjection = ownership.createOwner();
await workspaceProjection.retain("opaque-generation-capability");

// The final cooperative owner release retires the manager generation.
await workspaceProjection.release();
```

An owner-to-generation retention is idempotent. Concurrent calls for the same owner and key share
one task. If an older retirement is unsettled, `retain()` waits for that barrier and rechecks the
owner and generation before it acquires, so consumers do not implement a retry race. Releasing an
owner is terminal and repeated calls share one settlement. If several final retirements fail,
`release()` rejects with an `AggregateError` containing only fixed, generation-key-free ownership
errors; failed cleanup remains fenced and charged against `maxGenerations`.

`forceRetire(key)` immediately revokes every current reference and fences every owner that existed
when the force began. An owner created after that boundary may reuse an equal `Map` key only after
the manager retirement fully settles; old retirement work can therefore never overlap its
replacement. A manager-closed result counts as settled because manager shutdown already owns every
runtime generation.

Reversible desired-state transitions stay separate: call `manager.setOffline(key)` without
releasing the owner, then call `manager.ensureOnline(key)` when the host wants that retained
generation online again. Ownership finalization and `forceRetire()` call only `manager.retire()`.
`snapshot()` reports bounded aggregate counts and never emits generation keys or manager failures.

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
