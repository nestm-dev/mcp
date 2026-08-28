import { describe, expect, it, vi } from "vitest";

import {
	MCP_TOOL_RESULT_PROJECTION_DEFAULT_LIMITS,
	degradedMcpToolResult,
	projectMcpToolResult,
	resolveMcpToolResultProjectionLimits,
} from "../src/index.ts";

const limits = MCP_TOOL_RESULT_PROJECTION_DEFAULT_LIMITS;

describe("MCP tool-result projection", () => {
	it("resolves conservative immutable defaults and rejects unbounded policies", () => {
		expect(resolveMcpToolResultProjectionLimits(undefined)).toEqual(limits);
		expect(Object.isFrozen(resolveMcpToolResultProjectionLimits(undefined))).toBe(true);
		expect(() =>
			resolveMcpToolResultProjectionLimits({ maxStructuredNodes: Number.MAX_SAFE_INTEGER }),
		).toThrow(/maxStructuredNodes/u);
	});

	it("keeps text in wire order under per-block and shared UTF-8 budgets", () => {
		const perBlock = limits.maxTextBytesPerBlock;
		const blockCount = Math.floor(limits.maxTextBytesTotal / perBlock) + 2;
		const source = Array.from({ length: blockCount }, (_, index) => ({
			type: "text",
			text: index === 0 ? "\u{1f600}".repeat(perBlock) : "x".repeat(perBlock),
		}));

		const projected = projectMcpToolResult({ content: source });

		expect(projected.content).toHaveLength(blockCount);
		expect(projected.truncated).toBe(true);
		const total = projected.content.reduce(
			(bytes, block) => bytes + (block.kind === "text" ? Buffer.byteLength(block.text, "utf8") : 0),
			0,
		);
		expect(total).toBeLessThanOrEqual(limits.maxTextBytesTotal);
		const first = projected.content[0];
		if (first?.kind !== "text") throw new Error("expected text");
		expect(Buffer.byteLength(first.text, "utf8")).toBeLessThanOrEqual(perBlock);
		expect(JSON.parse(JSON.stringify(first.text))).toBe(first.text);
		const last = projected.content.at(-1);
		if (last?.kind !== "text") throw new Error("expected text");
		expect(last.text).toBe("");
		expect(last.truncated).toBe(true);
	});

	it("summarizes non-text blocks without carrying data, URIs, or future fields", () => {
		const projected = projectMcpToolResult({
			content: [
				{
					type: "image",
					data: "aGVsbG8gd29ybGQh",
					mimeType: "image/png",
					uri: "https://secret.example/private",
				},
				{ type: "future", secret: "never-copy-this" },
			],
		});

		expect(projected.content).toEqual([
			{ kind: "summary", contentType: "image", mediaType: "image/png", bytes: 12 },
			{ kind: "summary", contentType: "future" },
		]);
		expect(projected.truncated).toBe(true);
		expect(JSON.stringify(projected)).not.toContain("secret.example");
		expect(JSON.stringify(projected)).not.toContain("aGVsbG8");
		expect(JSON.stringify(projected)).not.toContain("never-copy-this");
	});

	it("copies structured content into frozen null-prototype bounded JSON", () => {
		let deep: unknown = "leaf";
		for (let index = 0; index < limits.maxStructuredDepth + 2; index += 1) {
			deep = { nested: deep };
		}
		const projected = projectMcpToolResult({
			content: [],
			structuredContent: {
				deep,
				long: "x".repeat(limits.maxStructuredStringBytes + 64),
			},
		});

		expect(projected.truncated).toBe(true);
		if (typeof projected.structuredContent !== "object" || projected.structuredContent === null) {
			throw new Error("expected projected structured content");
		}
		expect(Object.getPrototypeOf(projected.structuredContent)).toBeNull();
		expect(Object.isFrozen(projected.structuredContent)).toBe(true);
		expect(
			Buffer.byteLength(JSON.stringify(projected.structuredContent), "utf8"),
		).toBeLessThanOrEqual(limits.maxStructuredSerializedBytes);
	});

	it("drops __proto__, accessors, proxies, cycles, symbols, and exotic values without invoking them", () => {
		const getter = vi.fn(() => "secret");
		const nested: Record<PropertyKey, unknown> = { kept: 1 };
		Object.defineProperty(nested, "__proto__", {
			enumerable: true,
			value: { polluted: true },
		});
		const structured: Record<PropertyKey, unknown> = { safe: nested };
		Object.defineProperty(structured, "accessor", { enumerable: true, get: getter });
		structured.proxy = new Proxy({ secret: true }, {});
		structured.date = new Date();
		structured.cycle = structured;
		structured[Symbol("secret")] = "hidden";

		const projected = projectMcpToolResult({ content: [], structuredContent: structured });
		const serialized = JSON.stringify(projected.structuredContent);

		expect(getter).not.toHaveBeenCalled();
		expect(serialized).toContain('"kept":1');
		expect(serialized).not.toContain("__proto__");
		expect(serialized).not.toContain("polluted");
		expect(serialized).not.toContain("secret");
		expect(projected.truncated).toBe(true);
		expect(Object.prototype).not.toHaveProperty("polluted");
	});

	it("bounds sparse arrays by retained nodes instead of walking their declared length", () => {
		const sparse: unknown[] = [];
		sparse.length = 1_000_000_000;
		sparse[0] = "kept";
		const projected = projectMcpToolResult(
			{ content: [], structuredContent: sparse },
			{ maxStructuredNodes: 4 },
		);

		expect(projected.truncated).toBe(true);
		if (!Array.isArray(projected.structuredContent)) {
			throw new Error("expected projected array");
		}
		expect(projected.structuredContent.length).toBeLessThanOrEqual(3);
	});

	it("never reads source accessors at the result or block boundary", () => {
		const rootContent = vi.fn(() => []);
		const blockData = vi.fn(() => "secret");
		const root = {};
		Object.defineProperty(root, "content", { enumerable: true, get: rootContent });
		const block = { type: "image" };
		Object.defineProperty(block, "data", { enumerable: true, get: blockData });

		const rejectedRoot = projectMcpToolResult(root);
		const rejectedBlock = projectMcpToolResult({ content: [block] });

		expect(rootContent).not.toHaveBeenCalled();
		expect(blockData).not.toHaveBeenCalled();
		expect(rejectedRoot.truncated).toBe(true);
		expect(rejectedBlock.content).toEqual([{ kind: "summary", contentType: "image" }]);
	});

	it("returns an immutable literal degradation when the root cannot be inspected", () => {
		const projected = projectMcpToolResult(new Proxy({}, {}));
		const degraded = degradedMcpToolResult({ isError: true });

		expect(projected).toEqual({ content: [], isError: false, truncated: true });
		expect(degraded).toEqual({ content: [], isError: true, truncated: true });
		expect(Object.isFrozen(projected)).toBe(true);
		expect(Object.isFrozen(projected.content)).toBe(true);
	});
});
