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

/**
 * Conservative capture bounds for untrusted MCP payloads. They stay well inside
 * the canonicalizer's own fixed ceilings so a rejection happens before an
 * 8 MiB, 128-level, or 100,000-node canonical walk is ever attempted.
 */
export const MCP_CONFORMANCE_DEFAULT_CAPTURE_LIMITS = Object.freeze({
	maxBytes: 262_144,
	maxDepth: 24,
	maxProperties: 8_192,
	maxStringBytes: 32_768,
	maxItems: 512,
});

export const MCP_CONFORMANCE_HARD_CAPTURE_LIMITS = Object.freeze({
	maxBytes: 4_194_304,
	maxDepth: 64,
	maxProperties: 65_536,
	maxStringBytes: 1_048_576,
	maxItems: 8_192,
});

export interface McpConformanceCaptureLimits {
	/** Maximum UTF-8 byte length of the canonical JSON text the capture would produce. */
	readonly maxBytes: number;
	/** Maximum nesting depth, counting the captured root as depth zero. */
	readonly maxDepth: number;
	/** Maximum total object properties and array entries across the whole value. */
	readonly maxProperties: number;
	/** Maximum unescaped UTF-8 byte length of any single string, keys included. */
	readonly maxStringBytes: number;
	/** Maximum entries in any single array. */
	readonly maxItems: number;
}

export type ResolvedMcpConformanceCaptureLimits = Readonly<McpConformanceCaptureLimits>;

export function resolveMcpConformanceCaptureLimits(
	input: McpConformanceCaptureLimits | undefined,
): ResolvedMcpConformanceCaptureLimits {
	return Object.freeze({
		maxBytes: boundedPositiveInteger(
			input?.maxBytes ?? MCP_CONFORMANCE_DEFAULT_CAPTURE_LIMITS.maxBytes,
			"maxBytes",
			MCP_CONFORMANCE_HARD_CAPTURE_LIMITS.maxBytes,
		),
		maxDepth: boundedPositiveInteger(
			input?.maxDepth ?? MCP_CONFORMANCE_DEFAULT_CAPTURE_LIMITS.maxDepth,
			"maxDepth",
			MCP_CONFORMANCE_HARD_CAPTURE_LIMITS.maxDepth,
		),
		maxProperties: boundedPositiveInteger(
			input?.maxProperties ?? MCP_CONFORMANCE_DEFAULT_CAPTURE_LIMITS.maxProperties,
			"maxProperties",
			MCP_CONFORMANCE_HARD_CAPTURE_LIMITS.maxProperties,
		),
		maxStringBytes: boundedPositiveInteger(
			input?.maxStringBytes ?? MCP_CONFORMANCE_DEFAULT_CAPTURE_LIMITS.maxStringBytes,
			"maxStringBytes",
			MCP_CONFORMANCE_HARD_CAPTURE_LIMITS.maxStringBytes,
		),
		maxItems: boundedPositiveInteger(
			input?.maxItems ?? MCP_CONFORMANCE_DEFAULT_CAPTURE_LIMITS.maxItems,
			"maxItems",
			MCP_CONFORMANCE_HARD_CAPTURE_LIMITS.maxItems,
		),
	});
}

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
