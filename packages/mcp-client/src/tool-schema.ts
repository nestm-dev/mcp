import type { JsonSchemaType } from "@modelcontextprotocol/client";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/client/validators/ajv";

import type { McpClientToolInputSchema, McpClientToolOutputSchema } from "./types.ts";

export interface McpClientToolSchemaIssue {
	readonly message: string;
}

export type McpClientToolSchemaResult =
	{ readonly value: unknown } | { readonly issues: readonly McpClientToolSchemaIssue[] };

/**
 * Dependency-neutral Standard Schema view of an official MCP tool schema.
 *
 * The Standard Schema JSON conversion options deliberately accept `unknown`.
 * This keeps the public adapter structurally compatible across consumers that
 * resolve different compatible `@standard-schema/spec` versions.
 */
export interface McpClientToolStandardSchema {
	readonly "~standard": {
		readonly version: 1;
		readonly vendor: "@nestm/mcp-client";
		readonly validate: (value: unknown) => Promise<McpClientToolSchemaResult>;
		readonly jsonSchema: {
			readonly input: (options: unknown) => Record<string, unknown>;
			readonly output: (options: unknown) => Record<string, unknown>;
		};
	};
}

/**
 * Wraps and compiles a discovered MCP tool schema for Standard Schema
 * consumers. Invalid or unsupported schemas fail synchronously during
 * construction; each returned wrapper retains its compiled validator.
 */
export function createMcpClientToolSchema(
	schema: McpClientToolInputSchema | McpClientToolOutputSchema,
): McpClientToolStandardSchema {
	const jsonSchema = Object.fromEntries(Object.entries(structuredClone(schema)));
	const validatorSchema: JsonSchemaType = { ...jsonSchema };
	const validate = new AjvJsonSchemaValidator().getValidator<unknown>(validatorSchema);

	return {
		"~standard": {
			version: 1,
			vendor: "@nestm/mcp-client",
			async validate(value) {
				const result = validate(value);
				return result.valid
					? { value: result.data }
					: { issues: [{ message: result.errorMessage }] };
			},
			jsonSchema: {
				input: () => jsonSchema,
				output: () => jsonSchema,
			},
		},
	};
}
