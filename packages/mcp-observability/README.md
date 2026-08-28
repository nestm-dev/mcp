# @nestm/mcp-observability

Backend-neutral observability for NestM MCP clients, servers, and gateways. The package consumes the operation and lifecycle contracts from `@nestm/mcp-core`; it does not depend on a logging, metrics, or tracing SDK.

## Install

```sh
pnpm add @nestm/mcp-observability@alpha
```

## Safety defaults

Automatic telemetry contains only bounded protocol dimensions: runtime role, operation name and kind, capability, and (optionally) the named target. Principal data, operation payloads, arbitrary context attributes, operation/request/session IDs, error messages, stacks, tokens, cookies, and credentials are excluded by default.

String length, key length, and attribute count have hard upper bounds. Additional dimensions require an explicit `selectAttributes` hook, and sensitive-looking keys require a second `allowSensitiveAttribute` decision. Use `redactAttribute` to hash, bucket, normalize, or drop values before export.

## Lifecycle observers

```ts
import { composeMcpLifecycleObservers } from "@nestm/mcp-core";
import { createMcpLoggerObserver, createMcpMetricsObserver } from "@nestm/mcp-observability";

const observer = composeMcpLifecycleObservers([
	createMcpLoggerObserver({
		write: ({ level, message, attributes }) => logger[level](attributes, message),
	}),
	createMcpMetricsObserver({
		record: (measurements) => metrics.record(measurements),
	}),
]);
```

The logger emits one immutable structured record per lifecycle event. Failures include only `error.type` and an optional `error.code`. The metrics observer emits batches for started/completed counters, active operations, and duration in milliseconds.

Pass the composed observer to the `lifecycleObserver` option of a NestM runtime. Runtime lifecycle middleware treats observers as best-effort, so telemetry outages do not replace MCP results or errors.

## Fixed-memory metrics

For a process-local dashboard or a small deployment without a metrics SDK, the package includes a
framework-neutral collector for the canonical batches emitted by `createMcpMetricsObserver`:

```ts
import {
	McpFixedMemoryMetricsCollector,
	createMcpMetricsObserver,
} from "@nestm/mcp-observability/metrics";

const metrics = new McpFixedMemoryMetricsCollector();
const observer = createMcpMetricsObserver(metrics);

const snapshot = metrics.snapshot();
const prometheus = metrics.renderPrometheus();
```

`McpMetricsSnapshot` contains lifetime totals, bounded operation groups, and a fixed 15-minute
window of 60 15-second buckets. Durations use exported fixed histogram bounds; `p50Ms` and `p95Ms`
are bin estimates clamped by the observed maximum. Snapshots are deeply frozen and exclude targets,
identifiers, inputs, outputs, and errors. When the operation-group bound is reached, later dimensions
are folded into one `other` group per runtime role and operation kind.

The collector accepts only exact, internally consistent default measurement batches. Partial,
renamed, malformed, out-of-range, or mismatched batches are ignored atomically. Its memory use is
fixed by `MCP_METRICS_BUCKET_COUNT`, `MCP_METRICS_HISTOGRAM_BOUNDS_MS`, and
`MCP_METRICS_MAX_OPERATION_GROUPS`.

## Structural tracing

```ts
import { createMcpTracingMiddleware } from "@nestm/mcp-observability/tracing";

const tracing = createMcpTracingMiddleware({
	startSpan: (name, options) => myTracer.startSpan(name, options),
	withSpan: (span, callback) => myTracer.withActiveSpan(span, callback),
});
```

Implement the small `McpTracer` and `McpTraceSpan` interfaces for OpenTelemetry or another backend. Spans receive safe bounded attributes and static failure status text. Raw exception recording is deliberately off; use the explicit `recordError` hook when the backend's data policy permits messages and stacks.

Tracing backend failures are reported through `onInstrumentationError` and are contained so they cannot replace an operation result or primary error.

## Attribute policy

```ts
const projection = {
	selectAttributes: (context) => ({
		"tenant.bucket": bucketTenant(context),
	}),
	redactAttribute: ({ key, value }) => {
		if (key === "tenant.bucket") return hash(String(value));
		return typeof value === "string" ? value : undefined;
	},
};
```

Avoid dimensions with unbounded cardinality such as user IDs, URLs, prompts, resource contents, and request/session identifiers. Prefer stable buckets for metrics and logs, and keep direct correlation data in an explicitly governed tracing backend.
