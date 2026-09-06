import { describe, expect, it, vi } from "vitest";
import { createAiSdkMcpTools } from "../src/ai-sdk/index.ts";

const descriptor = {
	name: "lookup",
	description: "Lookup an entry",
	inputSchema: { type: "object" as const, properties: { query: { type: "string" as const } } },
};
describe("AI SDK MCP tool adapter", () => {
	it("delegates the exact name, input and cancellation signal without selecting a runtime", async () => {
		const invoke = vi.fn(async () => ({ content: "found" }));
		const tools = createAiSdkMcpTools([descriptor], invoke);
		const controller = new AbortController();
		const input = { query: "entry" };
		const result = await tools.lookup!.execute!(input, {
			abortSignal: controller.signal,
			toolCallId: "one",
			context: {},
			messages: [],
		});
		expect(result).toEqual({ content: "found" });
		expect(invoke).toHaveBeenCalledWith("lookup", input, controller.signal);
		expect(tools.lookup!.description).toBe(descriptor.description);
	});
	it("rejects duplicate names and safely supports object-property names", () => {
		expect(() => createAiSdkMcpTools([descriptor, descriptor], vi.fn())).toThrow(/unique/u);
		const tools = createAiSdkMcpTools([{ ...descriptor, name: "__proto__" }], vi.fn());
		expect(Object.hasOwn(tools, "__proto__")).toBe(true);
	});
	it("captures descriptors and blocks cancelled invocation and late delivery", async () => {
		const mutable = structuredClone(descriptor);
		const controller = new AbortController();
		const invoke = vi.fn(async () => {
			controller.abort();
			return "late";
		});
		const tools = createAiSdkMcpTools([mutable], invoke);
		mutable.name = "another";
		await expect(
			tools.lookup!.execute!(
				{},
				{ abortSignal: controller.signal, toolCallId: "one", context: {}, messages: [] },
			),
		).rejects.toThrow();
		expect(invoke).toHaveBeenCalledWith("lookup", {}, controller.signal);
		await expect(
			tools.lookup!.execute!(
				{},
				{ abortSignal: controller.signal, toolCallId: "two", context: {}, messages: [] },
			),
		).rejects.toThrow();
		expect(invoke).toHaveBeenCalledOnce();
	});
});
