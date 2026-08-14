import { describe, expect, it } from "vitest";

import { createMcpClientToolSchema, type McpClientToolInputSchema } from "../src/index.ts";

describe("createMcpClientToolSchema", () => {
	it("compiles and validates a detached discovered schema", async () => {
		const discovered = {
			type: "object",
			additionalProperties: false,
			properties: { query: { type: "string" } },
			required: ["query"],
		} satisfies McpClientToolInputSchema;
		const schema = createMcpClientToolSchema(discovered);
		const projected = schema["~standard"].jsonSchema.input({ target: "draft-07" });

		expect(projected).toEqual(discovered);
		expect(projected).not.toBe(discovered);
		await expect(schema["~standard"].validate({ query: "registry" })).resolves.toEqual({
			value: { query: "registry" },
		});

		for (const invalid of [{}, { query: 42 }, { query: "registry", extra: true }]) {
			const result = await schema["~standard"].validate(invalid);
			expect(result).toEqual({
				issues: [{ message: expect.any(String) }],
			});
		}
	});

	it("isolates compiled schema identifiers between wrappers", () => {
		const discovered = {
			$id: "urn:artifact:test:shared-tool-schema",
			type: "object",
			properties: { query: { type: "string" } },
		} satisfies McpClientToolInputSchema;

		expect(() => createMcpClientToolSchema(discovered)).not.toThrow();
		expect(() => createMcpClientToolSchema(discovered)).not.toThrow();
	});

	it.each([
		{
			label: "invalid keyword value",
			schema: {
				type: "object" as const,
				properties: { query: { type: "not-a-json-schema-type" } },
			},
		},
		{
			label: "invalid regular expression",
			schema: {
				type: "object" as const,
				properties: { query: { type: "string", pattern: "[" } },
			},
		},
		{
			label: "unsupported dialect",
			schema: {
				$schema: "https://schemas.example.test/unsupported",
				type: "object" as const,
			},
		},
	])("fails closed for an $label schema", ({ schema }) => {
		expect(() => createMcpClientToolSchema(schema)).toThrow();
	});
});
