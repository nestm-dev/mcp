export const MCP_METRICS_BUCKET_MS = 15_000;
export const MCP_METRICS_BUCKET_COUNT = 60;
export const MCP_METRICS_MAX_OPERATION_GROUPS = 100;

export const MCP_METRICS_HISTOGRAM_BOUNDS_MS = Object.freeze([
	5,
	10,
	25,
	50,
	100,
	250,
	500,
	1_000,
	2_500,
	5_000,
	10_000,
	30_000,
	60_000,
	120_000,
	Number.POSITIVE_INFINITY,
] as const);

export type McpMetricRole = "client" | "server" | "gateway";
export type McpMetricOperationKind = "request" | "notification";
export type McpMetricOutcome = "success" | "error" | "cancelled";

export interface McpMetricOutcomesView {
	readonly success: number;
	readonly error: number;
	readonly cancelled: number;
}

export interface McpMetricDurationView {
	readonly count: number;
	readonly averageMs: number | null;
	readonly p50Ms: number | null;
	readonly p95Ms: number | null;
	readonly maxMs: number | null;
}

export interface McpMetricAggregateView {
	readonly started: number;
	readonly active: number;
	readonly outcomes: McpMetricOutcomesView;
	readonly duration: McpMetricDurationView;
}

export interface McpMetricBucketView {
	readonly startedAt: string;
	readonly started: number;
	readonly outcomes: McpMetricOutcomesView;
	readonly duration: McpMetricDurationView;
}

export interface McpMetricOperationView extends McpMetricAggregateView {
	readonly role: McpMetricRole;
	readonly name: string;
	readonly kind: McpMetricOperationKind;
	readonly capability?: string;
}

export interface McpMetricsSnapshotView {
	readonly scope: "process";
	readonly startedAt: string;
	readonly capturedAt: string;
	readonly totals: McpMetricAggregateView;
	readonly window: {
		readonly bucketSeconds: number;
		readonly buckets: readonly McpMetricBucketView[];
	};
	readonly operations: readonly McpMetricOperationView[];
	readonly operationsTruncated: boolean;
}
