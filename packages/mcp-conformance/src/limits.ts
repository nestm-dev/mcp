export const MCP_CONFORMANCE_DEFAULT_LIMITS = Object.freeze({
	checkTimeoutMs: 2_000,
	runTimeoutMs: 8_000,
	maxChecks: 64,
	maxFactsPerCheck: 32,
	maxFactStringLength: 256,
	maxJsonBytes: 1_048_576,
	maxJunitBytes: 1_048_576,
});

export const MCP_CONFORMANCE_HARD_LIMITS = Object.freeze({
	maxChecks: 128,
	maxCheckTimeoutMs: 30_000,
	maxRunTimeoutMs: 60_000,
	maxFactsPerCheck: 64,
	maxFactStringLength: 1_024,
	maxJsonBytes: 4_194_304,
	maxJunitBytes: 4_194_304,
});

export interface McpConformanceLimits {
	readonly checkTimeoutMs?: number;
	readonly runTimeoutMs?: number;
	readonly maxChecks?: number;
	readonly maxFactsPerCheck?: number;
	readonly maxFactStringLength?: number;
	readonly maxJsonBytes?: number;
}

export interface ResolvedMcpConformanceLimits {
	readonly checkTimeoutMs: number;
	readonly runTimeoutMs: number;
	readonly maxChecks: number;
	readonly maxFactsPerCheck: number;
	readonly maxFactStringLength: number;
	readonly maxJsonBytes: number;
}

export function resolveMcpConformanceLimits(
	input: McpConformanceLimits | undefined,
): ResolvedMcpConformanceLimits {
	return Object.freeze({
		checkTimeoutMs: boundedPositiveInteger(
			input?.checkTimeoutMs ?? MCP_CONFORMANCE_DEFAULT_LIMITS.checkTimeoutMs,
			"checkTimeoutMs",
			MCP_CONFORMANCE_HARD_LIMITS.maxCheckTimeoutMs,
		),
		runTimeoutMs: boundedPositiveInteger(
			input?.runTimeoutMs ?? MCP_CONFORMANCE_DEFAULT_LIMITS.runTimeoutMs,
			"runTimeoutMs",
			MCP_CONFORMANCE_HARD_LIMITS.maxRunTimeoutMs,
		),
		maxChecks: boundedPositiveInteger(
			input?.maxChecks ?? MCP_CONFORMANCE_DEFAULT_LIMITS.maxChecks,
			"maxChecks",
			MCP_CONFORMANCE_HARD_LIMITS.maxChecks,
		),
		maxFactsPerCheck: boundedPositiveInteger(
			input?.maxFactsPerCheck ?? MCP_CONFORMANCE_DEFAULT_LIMITS.maxFactsPerCheck,
			"maxFactsPerCheck",
			MCP_CONFORMANCE_HARD_LIMITS.maxFactsPerCheck,
		),
		maxFactStringLength: boundedPositiveInteger(
			input?.maxFactStringLength ?? MCP_CONFORMANCE_DEFAULT_LIMITS.maxFactStringLength,
			"maxFactStringLength",
			MCP_CONFORMANCE_HARD_LIMITS.maxFactStringLength,
		),
		maxJsonBytes: boundedPositiveInteger(
			input?.maxJsonBytes ?? MCP_CONFORMANCE_DEFAULT_LIMITS.maxJsonBytes,
			"maxJsonBytes",
			MCP_CONFORMANCE_HARD_LIMITS.maxJsonBytes,
		),
	});
}

function boundedPositiveInteger(value: number, name: string, maximum: number): number {
	if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
		throw new RangeError(`${name} must be a positive integer no greater than ${String(maximum)}.`);
	}
	return value;
}
