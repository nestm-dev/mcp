import {
	METHOD_NOT_FOUND,
	ProtocolError,
	type Prompt,
	type Resource,
	type ResourceTemplateType,
	type Tool,
} from "@modelcontextprotocol/client";
import {
	createMcpClientToolSchema,
	type McpClientToolInputSchema,
	type McpClientToolOutputSchema,
} from "@nestm/mcp-client";
import {
	defineMcpConformancePlan,
	fingerprintMcpConformanceValue,
	type McpConformanceCheckOutcome,
	type McpConformancePlan,
} from "@nestm/mcp-conformance";
import type { McpManagedClientRuntime } from "@nestm/mcp-manager";

import { SAFE_DISCOVERY_PLAN_ID } from "./conformance.types.ts";

const MAX_TOOL_SCHEMA_BYTES = 262_144;
const MAX_TOOL_SCHEMA_DEPTH = 64;
const MAX_TOOL_SCHEMA_NODES = 10_000;
const MAX_INSPECTED_SCHEMAS = 256;
const MAX_INSPECTED_SCHEMA_BYTES = 2_097_152;
const MAX_INSPECTED_SCHEMA_NODES = 50_000;
const MAX_CATALOG_ITEM_BYTES = 2_097_152;
const MAX_CATALOG_ITEM_NODES = 20_000;
const MAX_CATALOG_BYTES = 4_194_304;
const MAX_CATALOG_NODES = 100_000;
const MAX_CATALOG_DEPTH = 72;
const MAX_CATALOG_STRING_BYTES = 1_048_576;

export interface SafeDiscoveryCatalog {
	readonly tools: readonly Tool[];
	readonly resources: readonly Resource[];
	readonly resourceTemplates: readonly ResourceTemplateType[];
	readonly prompts: readonly Prompt[];
}

export interface SafeDiscoveryTarget {
	snapshot(): ReturnType<McpManagedClientRuntime["snapshot"]>;
	ping(signal: AbortSignal): Promise<void>;
	catalog(signal: AbortSignal): Promise<SafeDiscoveryCatalog>;
}

export const SAFE_DISCOVERY_PLAN: McpConformancePlan<SafeDiscoveryTarget> =
	defineMcpConformancePlan({
		id: SAFE_DISCOVERY_PLAN_ID,
		version: "1.0.0",
		title: "Safe MCP discovery conformance",
		checks: [
			{
				id: "connection.connected",
				title: "Managed connection is connected",
				risk: "read-only",
				run: ({ target }) => {
					const snapshot = target.snapshot();
					return snapshot.state === "connected"
						? outcome("pass", "CONNECTION_CONNECTED", { state: snapshot.state })
						: outcome("fail", "CONNECTION_NOT_CONNECTED", { state: snapshot.state });
				},
			},
			{
				id: "protocol.negotiated",
				title: "Protocol version is negotiated",
				risk: "read-only",
				run: ({ target }) => {
					const snapshot = target.snapshot();
					if (
						snapshot.negotiatedProtocolVersion === undefined ||
						snapshot.protocolEra === undefined
					) {
						return outcome("fail", "PROTOCOL_NOT_NEGOTIATED");
					}
					return outcome("pass", "PROTOCOL_NEGOTIATED", {
						protocolVersion: snapshot.negotiatedProtocolVersion,
						protocolEra: snapshot.protocolEra,
					});
				},
			},
			{
				id: "protocol.ping",
				title: "Server answers a ping",
				risk: "read-only",
				async run({ target, signal }) {
					try {
						await target.ping(signal);
						return outcome("pass", "PING_SUCCEEDED");
					} catch {
						signal.throwIfAborted();
						return outcome("error", "PING_UNAVAILABLE");
					}
				},
			},
			{
				id: "catalog.discovery",
				title: "Bounded catalog discovery succeeds",
				risk: "read-only",
				timeoutMs: 6_000,
				async run({ target, signal }) {
					try {
						const catalog = await target.catalog(signal);
						return outcome("pass", "CATALOG_DISCOVERED", catalogCounts(catalog));
					} catch {
						signal.throwIfAborted();
						return outcome("error", "CATALOG_DISCOVERY_ERROR");
					}
				},
			},
			{
				id: "catalog.identities",
				title: "Catalog identities are unique",
				risk: "read-only",
				async run({ target, signal }) {
					try {
						const catalog = await target.catalog(signal);
						const duplicateCount = countDuplicates(catalog);
						return duplicateCount === 0
							? outcome("pass", "CATALOG_IDENTITIES_UNIQUE")
							: outcome("fail", "CATALOG_IDENTITIES_DUPLICATED", { duplicateCount });
					} catch {
						signal.throwIfAborted();
						return outcome("error", "CATALOG_UNAVAILABLE");
					}
				},
			},
			{
				id: "tools.schemas",
				title: "Tool schemas compile",
				risk: "read-only",
				async run({ target, signal }) {
					try {
						const catalog = await target.catalog(signal);
						let invalidInputSchemas = 0;
						let invalidOutputSchemas = 0;
						const budget = createToolSchemaBudget();
						try {
							for (const tool of catalog.tools) {
								if (!toolSchemaCompiles(tool.inputSchema, budget)) {
									invalidInputSchemas += 1;
								}
								if (
									tool.outputSchema !== undefined &&
									!toolSchemaCompiles(tool.outputSchema, budget)
								) {
									invalidOutputSchemas += 1;
								}
							}
						} catch (error) {
							if (error instanceof ToolSchemaBudgetExceededError) {
								return outcome("error", "TOOL_SCHEMA_BUDGET_EXCEEDED", {
									inspectedSchemaCount: budget.schemaCount,
								});
							}
							throw error;
						}
						const invalidSchemas = invalidInputSchemas + invalidOutputSchemas;
						return invalidSchemas === 0
							? outcome("pass", "TOOL_SCHEMAS_COMPILE", { toolCount: catalog.tools.length })
							: outcome("fail", "TOOL_SCHEMAS_INVALID", {
									invalidInputSchemas,
									invalidOutputSchemas,
								});
					} catch {
						signal.throwIfAborted();
						return outcome("error", "CATALOG_UNAVAILABLE");
					}
				},
			},
			{
				id: "catalog.digest",
				title: "Catalog has a stable semantic digest",
				risk: "read-only",
				async run({ target, signal }) {
					try {
						const catalog = await target.catalog(signal);
						return outcome("pass", "CATALOG_DIGESTED", {
							catalogDigest: fingerprintMcpConformanceValue(
								canonicalCatalog(catalog),
								"mcp-catalog",
							),
						});
					} catch {
						signal.throwIfAborted();
						return outcome("error", "CATALOG_DIGEST_ERROR");
					}
				},
			},
		],
	});

export function createSafeDiscoveryTarget(input: {
	readonly runtime: McpManagedClientRuntime;
	readonly serverName: string;
	readonly leaseSignal: AbortSignal;
	readonly maxPages: number;
	readonly maxItems: number;
}): SafeDiscoveryTarget {
	let catalogTask: Promise<SafeDiscoveryCatalog> | undefined;
	return Object.freeze({
		snapshot: () => input.runtime.snapshot(input.serverName),
		async ping(signal: AbortSignal): Promise<void> {
			await input.runtime.request(
				input.serverName,
				{ method: "ping" },
				{ signal: AbortSignal.any([input.leaseSignal, signal]) },
			);
		},
		catalog(signal: AbortSignal): Promise<SafeDiscoveryCatalog> {
			catalogTask ??= discoverCatalog(input, signal);
			return catalogTask;
		},
	});
}

async function discoverCatalog(
	input: Parameters<typeof createSafeDiscoveryTarget>[0],
	signal: AbortSignal,
): Promise<SafeDiscoveryCatalog> {
	const operationSignal = AbortSignal.any([input.leaseSignal, signal]);
	const snapshot = input.runtime.snapshot(input.serverName);
	const capabilities = snapshot.serverCapabilities;
	let totalItems = 0;
	const catalogBudget = createCatalogBudget();
	const account = <Value>(items: readonly Value[]): readonly Value[] => {
		totalItems += items.length;
		if (totalItems > input.maxItems) throw new RangeError("catalog item limit exceeded");
		for (const item of items) assertBoundedCatalogItem(item, catalogBudget);
		return items;
	};

	const tools =
		capabilities?.tools === undefined
			? []
			: await aggregatePages<Tool>(
					async (cursor) => {
						const page = await input.runtime.request(
							input.serverName,
							cursor === undefined
								? { method: "tools/list", params: {} }
								: { method: "tools/list", params: { cursor } },
							{ signal: operationSignal },
						);
						return page.nextCursor === undefined
							? { items: account(page.tools) }
							: { items: account(page.tools), nextCursor: page.nextCursor };
					},
					input.maxPages,
					operationSignal,
				);
	const resources =
		capabilities?.resources === undefined
			? []
			: await aggregatePages<Resource>(
					async (cursor) => {
						const page = await input.runtime.request(
							input.serverName,
							cursor === undefined
								? { method: "resources/list", params: {} }
								: { method: "resources/list", params: { cursor } },
							{ signal: operationSignal },
						);
						return page.nextCursor === undefined
							? { items: account(page.resources) }
							: { items: account(page.resources), nextCursor: page.nextCursor };
					},
					input.maxPages,
					operationSignal,
				);
	let resourceTemplates: readonly ResourceTemplateType[] = [];
	if (capabilities?.resources !== undefined) {
		try {
			resourceTemplates = await aggregatePages<ResourceTemplateType>(
				async (cursor) => {
					const page = await input.runtime.request(
						input.serverName,
						cursor === undefined
							? { method: "resources/templates/list", params: {} }
							: { method: "resources/templates/list", params: { cursor } },
						{ signal: operationSignal },
					);
					return page.nextCursor === undefined
						? { items: account(page.resourceTemplates) }
						: { items: account(page.resourceTemplates), nextCursor: page.nextCursor };
				},
				input.maxPages,
				operationSignal,
			);
		} catch (error) {
			if (!(ProtocolError.isInstance(error) && error.code === METHOD_NOT_FOUND)) throw error;
		}
	}
	const prompts =
		capabilities?.prompts === undefined
			? []
			: await aggregatePages<Prompt>(
					async (cursor) => {
						const page = await input.runtime.request(
							input.serverName,
							cursor === undefined
								? { method: "prompts/list", params: {} }
								: { method: "prompts/list", params: { cursor } },
							{ signal: operationSignal },
						);
						return page.nextCursor === undefined
							? { items: account(page.prompts) }
							: { items: account(page.prompts), nextCursor: page.nextCursor };
					},
					input.maxPages,
					operationSignal,
				);

	return Object.freeze({
		tools: Object.freeze(tools),
		resources: Object.freeze(resources),
		resourceTemplates: Object.freeze(resourceTemplates),
		prompts: Object.freeze(prompts),
	});
}

async function aggregatePages<Value>(
	load: (
		cursor: string | undefined,
	) => Promise<{ readonly items: readonly Value[]; readonly nextCursor?: string }>,
	maxPages: number,
	signal: AbortSignal,
): Promise<Value[]> {
	const result: Value[] = [];
	const cursors = new Set<string>();
	let cursor: string | undefined;
	for (let pageNumber = 0; pageNumber < maxPages; pageNumber += 1) {
		signal.throwIfAborted();
		const page = await load(cursor);
		result.push(...page.items);
		if (page.nextCursor === undefined || page.nextCursor.length === 0) return result;
		if (cursors.has(page.nextCursor)) throw new TypeError("catalog cursor repeated");
		cursors.add(page.nextCursor);
		cursor = page.nextCursor;
	}
	throw new RangeError("catalog page limit exceeded");
}

function outcome(
	status: McpConformanceCheckOutcome["status"],
	code: string,
	facts?: McpConformanceCheckOutcome["facts"],
): McpConformanceCheckOutcome {
	return Object.freeze({ status, code, ...(facts === undefined ? {} : { facts }) });
}

function catalogCounts(catalog: SafeDiscoveryCatalog): Record<string, number> {
	return {
		toolCount: catalog.tools.length,
		resourceCount: catalog.resources.length,
		resourceTemplateCount: catalog.resourceTemplates.length,
		promptCount: catalog.prompts.length,
	};
}

function countDuplicates(catalog: SafeDiscoveryCatalog): number {
	return (
		duplicates(catalog.tools.map(({ name }) => name)) +
		duplicates(catalog.resources.map(({ uri }) => uri)) +
		duplicates(catalog.resourceTemplates.map(({ uriTemplate }) => uriTemplate)) +
		duplicates(catalog.prompts.map(({ name }) => name))
	);
}

function duplicates(identities: readonly string[]): number {
	return identities.length - new Set(identities).size;
}

function canonicalCatalog(catalog: SafeDiscoveryCatalog): unknown {
	return {
		tools: [...catalog.tools].toSorted((left, right) => compare(left.name, right.name)),
		resources: [...catalog.resources].toSorted((left, right) => compare(left.uri, right.uri)),
		resourceTemplates: [...catalog.resourceTemplates].toSorted((left, right) =>
			compare(left.uriTemplate, right.uriTemplate),
		),
		prompts: [...catalog.prompts].toSorted((left, right) => compare(left.name, right.name)),
	};
}

function compare(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

interface ToolSchemaBudget {
	schemaCount: number;
	bytes: number;
	nodes: number;
}

interface CatalogBudget {
	bytes: number;
	nodes: number;
}

interface JsonMeasurement {
	readonly bytes: number;
	readonly nodes: number;
}

interface JsonMeasurementLimits {
	readonly maxBytes: number;
	readonly maxNodes: number;
	readonly maxDepth: number;
	readonly maxStringBytes: number;
}

class ToolSchemaBudgetExceededError extends Error {}

function createToolSchemaBudget(): ToolSchemaBudget {
	return { schemaCount: 0, bytes: 0, nodes: 0 };
}

function createCatalogBudget(): CatalogBudget {
	return { bytes: 0, nodes: 0 };
}

function assertBoundedCatalogItem(item: unknown, budget: CatalogBudget): void {
	const measurement = measureBoundedJsonValue(item, {
		maxBytes: MAX_CATALOG_ITEM_BYTES,
		maxNodes: MAX_CATALOG_ITEM_NODES,
		maxDepth: MAX_CATALOG_DEPTH,
		maxStringBytes: MAX_CATALOG_STRING_BYTES,
	});
	budget.bytes += measurement.bytes;
	budget.nodes += measurement.nodes;
	if (budget.bytes > MAX_CATALOG_BYTES || budget.nodes > MAX_CATALOG_NODES) {
		throw new RangeError("catalog inspection budget exceeded");
	}
}

function toolSchemaCompiles(
	schema: McpClientToolInputSchema | McpClientToolOutputSchema,
	budget: ToolSchemaBudget,
): boolean {
	try {
		assertBoundedToolSchema(schema, budget);
		createMcpClientToolSchema(schema);
		return true;
	} catch (error) {
		if (error instanceof ToolSchemaBudgetExceededError) throw error;
		return false;
	}
}

function assertBoundedToolSchema(schema: unknown, budget: ToolSchemaBudget): void {
	budget.schemaCount += 1;
	if (budget.schemaCount > MAX_INSPECTED_SCHEMAS) {
		throw new ToolSchemaBudgetExceededError("tool schema count budget exceeded");
	}
	const measurement = measureBoundedJsonValue(schema, {
		maxBytes: MAX_TOOL_SCHEMA_BYTES,
		maxNodes: MAX_TOOL_SCHEMA_NODES,
		maxDepth: MAX_TOOL_SCHEMA_DEPTH,
		maxStringBytes: MAX_TOOL_SCHEMA_BYTES,
	});
	budget.bytes += measurement.bytes;
	budget.nodes += measurement.nodes;
	if (budget.bytes > MAX_INSPECTED_SCHEMA_BYTES || budget.nodes > MAX_INSPECTED_SCHEMA_NODES) {
		throw new ToolSchemaBudgetExceededError("aggregate tool schema budget exceeded");
	}
}

/** Measures JSON text incrementally so limits are enforced before serialization or sorting. */
function measureBoundedJsonValue(value: unknown, limits: JsonMeasurementLimits): JsonMeasurement {
	const ancestors = new Set<object>();
	let bytes = 0;
	let nodes = 0;
	const addBytes = (additional: number): void => {
		bytes += additional;
		if (!Number.isSafeInteger(bytes) || bytes > limits.maxBytes) {
			throw new RangeError("JSON byte limit exceeded");
		}
	};
	const addString = (text: string): void => {
		let stringBytes = 2;
		addBytes(2);
		for (let index = 0; index < text.length; index += 1) {
			const codeUnit = text.charCodeAt(index);
			let encodedBytes: number;
			if (codeUnit < 0x20) {
				encodedBytes =
					codeUnit === 0x08 ||
					codeUnit === 0x09 ||
					codeUnit === 0x0a ||
					codeUnit === 0x0c ||
					codeUnit === 0x0d
						? 2
						: 6;
			} else if (codeUnit === 0x22 || codeUnit === 0x5c) {
				encodedBytes = 2;
			} else if (codeUnit <= 0x7f) {
				encodedBytes = 1;
			} else if (codeUnit <= 0x7ff) {
				encodedBytes = 2;
			} else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
				const next = text.charCodeAt(index + 1);
				if (next >= 0xdc00 && next <= 0xdfff) {
					encodedBytes = 4;
					index += 1;
				} else {
					encodedBytes = 6;
				}
			} else {
				encodedBytes = codeUnit >= 0xdc00 && codeUnit <= 0xdfff ? 6 : 3;
			}
			stringBytes += encodedBytes;
			if (stringBytes > limits.maxStringBytes) {
				throw new RangeError("JSON string byte limit exceeded");
			}
			addBytes(encodedBytes);
		}
	};
	const visit = (current: unknown, depth: number): void => {
		if (depth > limits.maxDepth) throw new RangeError("JSON depth limit exceeded");
		nodes += 1;
		if (nodes > limits.maxNodes) throw new RangeError("JSON node limit exceeded");
		if (current === null) {
			addBytes(4);
			return;
		}
		switch (typeof current) {
			case "string":
				addString(current);
				return;
			case "boolean":
				addBytes(current ? 4 : 5);
				return;
			case "number":
				if (!Number.isFinite(current)) throw new TypeError("JSON numbers must be finite");
				addBytes(String(Object.is(current, -0) ? 0 : current).length);
				return;
			case "object":
				break;
			default:
				throw new TypeError("value is not JSON-compatible");
		}

		if (ancestors.has(current)) throw new TypeError("JSON value contains a cycle");
		ancestors.add(current);
		try {
			if (Array.isArray(current)) {
				addBytes(2);
				for (let index = 0; index < current.length; index += 1) {
					if (index > 0) addBytes(1);
					if (Object.hasOwn(current, index)) visit(current[index], depth + 1);
					else visit(null, depth + 1);
				}
				return;
			}

			const prototype = Object.getPrototypeOf(current) as unknown;
			if (prototype !== Object.prototype && prototype !== null) {
				throw new TypeError("JSON objects must have a plain prototype");
			}
			addBytes(2);
			let propertyCount = 0;
			for (const key in current) {
				if (!Object.hasOwn(current, key)) continue;
				const descriptor = Object.getOwnPropertyDescriptor(current, key);
				if (descriptor === undefined || !descriptor.enumerable) continue;
				if (!("value" in descriptor)) throw new TypeError("JSON properties must be data values");
				if (propertyCount > 0) addBytes(1);
				propertyCount += 1;
				addString(key);
				addBytes(1);
				visit(descriptor.value, depth + 1);
			}
		} finally {
			ancestors.delete(current);
		}
	};

	visit(value, 0);
	return { bytes, nodes };
}
