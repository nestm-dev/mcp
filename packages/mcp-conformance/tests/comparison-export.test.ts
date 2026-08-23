import {
	compareMcpConformanceReports,
	defineMcpConformancePlan,
	parseMcpConformanceReport,
	parseMcpConformanceReportJson,
	runMcpConformancePlan,
	serializeMcpConformanceReport,
	toMcpConformanceJUnit,
	type McpConformanceCheckOutcome,
	type McpConformanceReport,
} from "../src/index.ts";
import { describe, expect, it } from "vitest";

describe("conformance comparison and export", () => {
	it("classifies regressions, improvements, review changes, and inconclusive checks", async () => {
		const baseline = await report("baseline", [
			{ status: "pass", code: "ONE_OK", facts: { digest: "one" } },
			{ status: "fail", code: "TWO_BAD" },
			{ status: "warn", code: "THREE_REVIEW", facts: { count: 1 } },
			{ status: "skip", code: "FOUR_UNSUPPORTED" },
		]);
		const candidate = await report("candidate", [
			{ status: "fail", code: "ONE_BAD", facts: { digest: "two" } },
			{ status: "pass", code: "TWO_OK" },
			{ status: "warn", code: "THREE_REVIEW", facts: { count: 2 } },
			{ status: "pass", code: "FOUR_OK" },
		]);
		const comparison = compareMcpConformanceReports(baseline, candidate);
		expect(comparison).toMatchObject({ comparable: true, verdict: "regressed" });
		if (!comparison.comparable) throw new Error("Expected comparable reports.");
		expect(comparison.checks.map((check) => check.change)).toEqual([
			"regression",
			"improvement",
			"review",
			"inconclusive",
		]);
		expect(Object.isFrozen(comparison)).toBe(true);
	});

	it("rejects comparisons across a different target identity", async () => {
		const baseline = await report("baseline", [{ status: "pass", code: "ONE_OK" }]);
		const candidate = await report("candidate", [{ status: "pass", code: "ONE_OK" }], "fixture-b");
		expect(compareMcpConformanceReports(baseline, candidate)).toEqual({
			comparable: false,
			baselineRunId: "baseline",
			candidateRunId: "candidate",
			reasons: ["TARGET_CHANGED"],
		});
	});

	it("rejects comparisons across subjects and reviews omitted evidence", async () => {
		const baseline = await report("baseline", [{ status: "pass", code: "ONE_OK" }]);
		const otherSubject = await report(
			"candidate",
			[{ status: "pass", code: "ONE_OK" }],
			"fixture-a",
			"@nestm/other",
		);
		expect(compareMcpConformanceReports(baseline, otherSubject)).toMatchObject({
			comparable: false,
			reasons: ["SUBJECT_CHANGED"],
		});

		const candidate = parseMcpConformanceReport({
			...baseline,
			runId: "candidate",
			checks: baseline.checks.map((check) => ({ ...check, factsOmittedCount: 1 })),
		});
		const comparison = compareMcpConformanceReports(baseline, candidate);
		expect(comparison).toMatchObject({ comparable: true, verdict: "review" });
		if (!comparison.comparable) throw new Error("Expected comparable reports.");
		expect(comparison.checks[0]).toMatchObject({
			change: "review",
			factsChanged: false,
			factsOmittedCountChanged: true,
		});
	});

	it("round-trips immutable JSON and rejects oversized input", async () => {
		const original = await report("json", [{ status: "pass", code: "ONE_OK" }]);
		const parsed = parseMcpConformanceReportJson(serializeMcpConformanceReport(original));
		expect(parsed).toEqual(original);
		expect(Object.isFrozen(parsed)).toBe(true);
		expect(() => parseMcpConformanceReportJson(`"${"x".repeat(1_048_577)}"`)).toThrow(
			/byte safety limit/u,
		);
	});

	it("enforces default report bytes while allowing a bounded explicit override", async () => {
		const facts = Object.fromEntries(
			Array.from({ length: 32 }, (_, index) => [`fact.${String(index)}`, "x".repeat(1_024)]),
		);
		const outcomes = Array.from(
			{ length: 64 },
			() => ({ status: "pass", code: "CHECK_OK", facts }) as const,
		);
		const large = await runMcpConformancePlan(
			defineMcpConformancePlan({
				id: "large",
				version: "1",
				title: "Large bounded report",
				checks: outcomes.map((_, index) => ({
					id: `check.${String(index)}`,
					title: `Check ${String(index)}`,
					risk: "read-only" as const,
					run: ({ target }: { readonly target: typeof outcomes }) => target[index]!,
				})),
			}),
			{
				target: outcomes,
				runId: "large-report",
				descriptor: {
					target: { kind: "fixture", id: "large" },
					subject: { name: "@nestm/mcp", version: "test" },
				},
				limits: {
					maxFactStringLength: 1_024,
					maxJsonBytes: 4_194_304,
				},
			},
		);
		expect(() => serializeMcpConformanceReport(large)).toThrow(/1048576 byte/u);
		const serialized = serializeMcpConformanceReport(large, { maximumBytes: 4_194_304 });
		expect(Buffer.byteLength(serialized, "utf8")).toBeGreaterThan(1_048_576);
		expect(parseMcpConformanceReportJson(serialized, { maximumBytes: 4_194_304 })).toEqual(large);

		const oversizedFacts = Object.fromEntries(
			Array.from({ length: 64 }, (_, index) => [`fact.${String(index)}`, "x".repeat(1_024)]),
		);
		expect(() =>
			parseMcpConformanceReport(
				{
					...large,
					checks: large.checks.map((check) => ({ ...check, facts: oversizedFacts })),
				},
				{ maximumBytes: 4_194_304 },
			),
		).toThrow(/hard JSON byte/u);
	});

	it("rejects duplicate identities, inconsistent time, and unsafe counters", async () => {
		const generated = await report("validated", [{ status: "pass", code: "ONE_OK" }]);
		const firstPlanCheck = generated.plan.checks[0]!;
		const firstReportCheck = generated.checks[0]!;
		expect(() =>
			parseMcpConformanceReport({
				...generated,
				plan: { ...generated.plan, checks: [firstPlanCheck, firstPlanCheck] },
				counts: { ...generated.counts, pass: 2 },
				checks: [firstReportCheck, firstReportCheck],
			}),
		).toThrow(/unique/u);
		expect(() =>
			parseMcpConformanceReport({
				...generated,
				finishedAt: "2025-01-01T00:00:00.000Z",
			}),
		).toThrow(/finish before/u);
		expect(() =>
			parseMcpConformanceReport({
				...generated,
				durationMs: Number.MAX_SAFE_INTEGER + 1,
			}),
		).toThrow();
	});

	it("maps stable statuses to escaped JUnit without exposing facts", async () => {
		const generated = await report("junit", [
			{ status: "pass", code: "PASS_OK" },
			{ status: "warn", code: "WARN_REVIEW", facts: { detail: "do-not-export" } },
			{ status: "fail", code: "FAIL_BAD" },
			{ status: "skip", code: "SKIP_UNSUPPORTED" },
		]);
		const tampered = {
			...generated,
			plan: {
				...generated.plan,
				title: "Plan <unsafe>\uD800",
				checks: generated.plan.checks.map((check, index) =>
					index === 0 ? { ...check, title: 'One & "unsafe"' } : check,
				),
			},
			checks: generated.checks.map((check, index) =>
				index === 0 ? { ...check, title: 'One & "unsafe"' } : check,
			),
		} as McpConformanceReport;
		const junit = toMcpConformanceJUnit(tampered);
		expect(junit).toContain("Plan &lt;unsafe&gt;");
		expect(junit).toContain("One &amp; &quot;unsafe&quot;");
		expect(junit).toContain("<failure");
		expect(junit).toContain("<skipped");
		expect(junit).toContain("mcp.status");
		expect(junit).not.toContain("do-not-export");
		expect(junit).not.toContain("\uD800");
	});
});

async function report(
	runId: string,
	outcomes: readonly McpConformanceCheckOutcome[],
	targetId = "fixture-a",
	subjectName = "@nestm/mcp",
): Promise<McpConformanceReport> {
	const plan = defineMcpConformancePlan({
		id: "comparison",
		version: "1",
		title: "Comparison",
		checks: outcomes.map((_, index) => ({
			id: `check.${String(index + 1)}`,
			title: `Check ${String(index + 1)}`,
			risk: "read-only" as const,
			run: ({ target }: { readonly target: readonly McpConformanceCheckOutcome[] }) =>
				target[index]!,
		})),
	});
	return runMcpConformancePlan(plan, {
		target: outcomes,
		runId,
		descriptor: {
			target: { kind: "connection", id: targetId, revision: 1, generation: 1 },
			subject: { name: subjectName, version: runId },
		},
	});
}
