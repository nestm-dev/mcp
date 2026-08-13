import { describe, expect, it } from "vitest";

import { McpMiddlewareReentryError, composeMcpMiddleware } from "../src/middleware.ts";
import { createMcpOperation, createMcpOperationContext } from "../src/operation.ts";
import type { McpOperationMiddleware } from "../src/operation.ts";

const operation = createMcpOperation(
	{ value: 1 },
	createMcpOperationContext({
		operationId: "middleware-op",
		role: "gateway",
		operation: { name: "tools/call", kind: "request" },
	}),
);

describe("composeMcpMiddleware", () => {
	it("runs middleware in onion order", async () => {
		const calls: string[] = [];
		const first: McpOperationMiddleware<{ value: number }, number> = async (_operation, next) => {
			calls.push("first:before");
			const result = await next();
			calls.push("first:after");
			return result + 1;
		};
		const second: McpOperationMiddleware<{ value: number }, number> = async (_operation, next) => {
			calls.push("second:before");
			const result = await next();
			calls.push("second:after");
			return result * 2;
		};
		const pipeline = composeMcpMiddleware([first, second], ({ input }) => {
			calls.push("terminal");
			return input.value;
		});

		await expect(pipeline(operation)).resolves.toBe(3);
		expect(calls).toEqual([
			"first:before",
			"second:before",
			"terminal",
			"second:after",
			"first:after",
		]);
	});

	it("rejects a second next call", async () => {
		const pipeline = composeMcpMiddleware(
			[
				async (_operation, next) => {
					await next();
					return next();
				},
			],
			() => 1,
		);

		await expect(pipeline(operation)).rejects.toBeInstanceOf(McpMiddlewareReentryError);
	});

	it("snapshots the middleware list and isolates concurrent invocations", async () => {
		const source: McpOperationMiddleware<{ value: number }, number>[] = [
			async (_operation, next) => next(),
		];
		const pipeline = composeMcpMiddleware(source, ({ input }) => input.value);
		source.push(() => 99);

		await expect(Promise.all([pipeline(operation), pipeline(operation)])).resolves.toEqual([1, 1]);
	});
});
