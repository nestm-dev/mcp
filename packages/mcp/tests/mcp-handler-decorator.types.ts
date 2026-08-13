import { fromJsonSchema } from "@nestm/mcp-server";
import { McpPrompt, McpResource, McpTool } from "../src/index.ts";

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
