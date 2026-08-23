import { canonicalizeMcpConformanceValue } from "./fingerprint.ts";
import type { McpConformanceCheckReport, McpConformanceReport } from "./report.ts";

export type McpConformanceComparisonVerdict =
	"equivalent" | "regressed" | "improved" | "review" | "inconclusive";

export type McpConformanceCheckChange =
	"equivalent" | "regression" | "improvement" | "review" | "inconclusive";

export interface McpConformanceComparableReportComparison {
	readonly comparable: true;
	readonly baselineRunId: string;
	readonly candidateRunId: string;
	readonly verdict: McpConformanceComparisonVerdict;
	readonly checks: readonly {
		readonly id: string;
		readonly change: McpConformanceCheckChange;
		readonly baselineStatus: McpConformanceCheckReport["status"];
		readonly candidateStatus: McpConformanceCheckReport["status"];
		readonly baselineCode: string;
		readonly candidateCode: string;
		readonly factsChanged: boolean;
		readonly factsOmittedCountChanged: boolean;
	}[];
}

export interface McpConformanceIncomparableReportComparison {
	readonly comparable: false;
	readonly baselineRunId: string;
	readonly candidateRunId: string;
	readonly reasons: readonly string[];
}

export type McpConformanceReportComparison =
	McpConformanceComparableReportComparison | McpConformanceIncomparableReportComparison;

export function compareMcpConformanceReports(
	baseline: McpConformanceReport,
	candidate: McpConformanceReport,
): McpConformanceReportComparison {
	const reasons = compatibilityReasons(baseline, candidate);
	if (reasons.length > 0) {
		return deepFreeze({
			comparable: false as const,
			baselineRunId: baseline.runId,
			candidateRunId: candidate.runId,
			reasons,
		});
	}
	const checks = baseline.checks.map((baselineCheck, index) => {
		const candidateCheck = candidate.checks[index];
		if (candidateCheck === undefined)
			throw new TypeError("Comparable reports lost check alignment.");
		const factsChanged =
			canonicalizeMcpConformanceValue(baselineCheck.facts) !==
			canonicalizeMcpConformanceValue(candidateCheck.facts);
		const factsOmittedCountChanged =
			baselineCheck.factsOmittedCount !== candidateCheck.factsOmittedCount;
		return {
			id: baselineCheck.id,
			change: classifyChange(
				baselineCheck,
				candidateCheck,
				factsChanged || factsOmittedCountChanged,
			),
			baselineStatus: baselineCheck.status,
			candidateStatus: candidateCheck.status,
			baselineCode: baselineCheck.code,
			candidateCode: candidateCheck.code,
			factsChanged,
			factsOmittedCountChanged,
		};
	});
	return deepFreeze({
		comparable: true as const,
		baselineRunId: baseline.runId,
		candidateRunId: candidate.runId,
		verdict: comparisonVerdict(checks.map((check) => check.change)),
		checks,
	});
}

function compatibilityReasons(
	baseline: McpConformanceReport,
	candidate: McpConformanceReport,
): string[] {
	const reasons: string[] = [];
	if (baseline.reportSchemaVersion !== candidate.reportSchemaVersion) {
		reasons.push("REPORT_SCHEMA_VERSION_CHANGED");
	}
	if (baseline.fingerprintVersion !== candidate.fingerprintVersion) {
		reasons.push("FINGERPRINT_VERSION_CHANGED");
	}
	if (
		baseline.plan.id !== candidate.plan.id ||
		baseline.plan.version !== candidate.plan.version ||
		baseline.plan.digest !== candidate.plan.digest
	) {
		reasons.push("PLAN_CHANGED");
	}
	if (
		baseline.descriptor.target.kind !== candidate.descriptor.target.kind ||
		baseline.descriptor.target.id !== candidate.descriptor.target.id
	) {
		reasons.push("TARGET_CHANGED");
	}
	if (baseline.descriptor.fixtureVersion !== candidate.descriptor.fixtureVersion) {
		reasons.push("FIXTURE_CHANGED");
	}
	if (baseline.descriptor.subject.name !== candidate.descriptor.subject.name) {
		reasons.push("SUBJECT_CHANGED");
	}
	if (
		baseline.checks.length !== candidate.checks.length ||
		baseline.checks.some((check, index) => check.id !== candidate.checks[index]?.id)
	) {
		reasons.push("CHECK_ORDER_CHANGED");
	}
	return reasons;
}

function classifyChange(
	baseline: McpConformanceCheckReport,
	candidate: McpConformanceCheckReport,
	factsChanged: boolean,
): McpConformanceCheckChange {
	if (
		baseline.status === "skip" ||
		baseline.status === "error" ||
		candidate.status === "skip" ||
		candidate.status === "error"
	) {
		return "inconclusive";
	}
	const ranks = { pass: 0, warn: 1, fail: 2 } as const;
	const baselineRank = ranks[baseline.status];
	const candidateRank = ranks[candidate.status];
	if (candidateRank > baselineRank) return "regression";
	if (candidateRank < baselineRank) return "improvement";
	if (baseline.code !== candidate.code || factsChanged) return "review";
	return "equivalent";
}

function comparisonVerdict(
	changes: readonly McpConformanceCheckChange[],
): McpConformanceComparisonVerdict {
	if (changes.includes("regression")) return "regressed";
	if (changes.includes("inconclusive")) return "inconclusive";
	if (changes.includes("review")) return "review";
	if (changes.includes("improvement")) return "improved";
	return "equivalent";
}

function deepFreeze<Value>(value: Value, seen = new WeakSet<object>()): Value {
	if (typeof value !== "object" || value === null || seen.has(value)) return value;
	seen.add(value);
	for (const child of Object.values(value)) deepFreeze(child, seen);
	return Object.freeze(value);
}
