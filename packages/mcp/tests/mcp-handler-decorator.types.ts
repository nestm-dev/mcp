import { fromJsonSchema } from "@nestm/mcp-server";
import {
	McpPrompt,
	McpResource,
	McpTool,
	createMcpHandlerPassthroughMiddleware,
} from "../src/index.ts";
import type {
	McpHandlerInvocationInput,
	McpHandlerInvocationOutputFor,
	ReadResourceResult,
} from "../src/index.ts";

type IsAssignable<Source, Target> = [Source] extends [Target] ? true : false;
type AssertFalse<Value extends false> = Value;
type ToolInvocation = McpHandlerInvocationInput & { readonly kind: "tool" };

/** Proves a resource result cannot cross a tool invocation discriminator. */
export type ToolInvocationRejectsResourceResult = AssertFalse<
	IsAssignable<ReadResourceResult, McpHandlerInvocationOutputFor<ToolInvocation>>
>;

createMcpHandlerPassthroughMiddleware(async (_operation, next) => {
	await next();
});

// @ts-expect-error Passthrough handler middleware cannot replace the SDK capability result.
createMcpHandlerPassthroughMiddleware(async () => ({ content: [] }));

const inputSchema = fromJsonSchema<{ name: string }>({
	type: "object",
	properties: { name: { type: "string" } },
	required: ["name"],
});

class ValidDecoratedHandlers {
	@McpTool({ name: "greet", inputSchema })
	greet({ name }: { name: string }) {
		return { content: [{ type: "text" as const, text: name }] };
	}

	@McpPrompt({ name: "summarize", argsSchema: inputSchema })
	summarize({ name }: { name: string }) {
		return {
			messages: [{ role: "user" as const, content: { type: "text" as const, text: name } }],
		};
	}

	@McpResource({ name: "guide", uri: "docs://guide" })
	guide(uri: URL) {
		return { contents: [{ uri: uri.href, text: "guide" }] };
	}
}

class InvalidDecoratedHandlers {
	// @ts-expect-error The schema requires a string-valued name argument.
	@McpTool({ name: "invalid", inputSchema })
	invalid({ name }: { name: number }) {
		return { content: [{ type: "text" as const, text: String(name) }] };
	}
}

void ValidDecoratedHandlers;
void InvalidDecoratedHandlers;
