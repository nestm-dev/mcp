# `@nestm/mcp-conformance`

A framework-neutral orchestration and report kernel for repeatable MCP validation.

The package executes a host-defined, ordered plan against an ephemeral target and produces a
bounded immutable report. It deliberately does not own transports, endpoints, credentials,
connections, persistence, baseline approval, or dashboard policy. Those stay in the host that
already owns the MCP runtime generation.

## Install

```sh
pnpm add @nestm/mcp-conformance
```

## Define and run a plan

```ts
import { defineMcpConformancePlan, runMcpConformancePlan } from "@nestm/mcp-conformance";

interface Target {
	ping(signal: AbortSignal): Promise<void>;
}

declare const target: Target;

const plan = defineMcpConformancePlan<Target>({
	id: "safe-discovery",
	version: "1",
	title: "Safe discovery",
	checks: [
		{
			id: "protocol.ping",
			title: "Protocol ping",
			risk: "read-only",
			async run({ target, signal }) {
				await target.ping(signal);
				return { status: "pass", code: "PING_OK" };
			},
		},
	],
});

const report = await runMcpConformancePlan(plan, {
	target,
	runId: crypto.randomUUID(),
	descriptor: {
		target: { kind: "connection", id: "fixture-a", revision: 3, generation: 2 },
		subject: { name: "@nestm/mcp", version: "0.1.0-alpha.4" },
	},
});
```

Checks run one at a time. Side-effecting checks are skipped unless `allowSideEffects: true` is
explicitly set. Caller cancellation and bounded run/check timeouts are propagated through the
check signal. A check may return `error` with a stable infrastructure code; otherwise thrown errors
are converted to `CHECK_THREW`. Error messages, stacks, inputs, and outputs never enter the report.
Observer callbacks are best-effort notifications: returned promises are deliberately not awaited,
so telemetry cannot delay checks or defeat run bounds.

The target adapter must propagate each check's `signal` into its underlying network, runtime, and
lease operations. A timeout bounds how long the runner waits; it cannot forcibly stop work that
ignores cancellation. Hosts should compose the check signal with generation-retirement and shutdown
signals, make adapter cleanup idempotent, and release the underlying lease only after cooperative
work has settled.

## Compare and export

```ts
import {
	compareMcpConformanceReports,
	serializeMcpConformanceReport,
	toMcpConformanceJUnit,
} from "@nestm/mcp-conformance";

const comparison = compareMcpConformanceReports(baseline, report);
const json = serializeMcpConformanceReport(report);
const junit = toMcpConformanceJUnit(report);
```

JSON parsing, runner output, and serialization use a 1 MiB default report limit. Trusted hosts that
need a larger report may set `limits.maxJsonBytes` on the runner and pass
`{ maximumBytes: value }` to JSON parsing or serialization, up to the 4 MiB hard limit.

Comparison requires the same report/fingerprint versions, plan digest, target identity, subject
name, fixture version, and ordered checks. Subject versions and runtime generations may differ
because comparing two builds or deployments is the intended use case. Same-status fact or omission
changes are marked for review; a fingerprint change alone is not claimed to be schema-compatible or
incompatible. Fingerprint inputs are capped at 8 MiB, 128 levels, and 100,000 JSON nodes before
canonical sorting. A confirmed regression remains the overall verdict even when another check is
inconclusive.

## Release-regression workflow

Run the same versioned plan and deterministic fixture in separate baseline and candidate
processes or containers. Each process must load exactly one library build and record its real
subject version or revision; do not swap two installed builds inside one running process. Persist
each immutable report as a JSON build artifact and, when CI presentation needs it, persist its JUnit
projection alongside it.

A trusted comparison job should parse both bounded JSON artifacts with
`parseMcpConformanceReportJson`, call `compareMcpConformanceReports`, and apply the repository's
release policy to the verdict. Keep plan code, fixture admission, artifact storage, baseline
approval, and release authorization outside untrusted dashboard input.

## Safety boundary

Facts are restricted to bounded scalar values. Sensitive-looking fact keys are omitted, strings
are truncated, and caught exception details are never serialized. A host should still author plans
as trusted code and must not deserialize executable checks or accept arbitrary operations from a
dashboard request.
