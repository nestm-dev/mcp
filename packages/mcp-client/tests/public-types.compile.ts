import type {
	CallToolResult,
	InputRequiredResult,
	McpClientProtocolRequest,
	McpClientRuntime,
} from "../src/index.ts";
import { createMcpClientPassthroughMiddleware } from "../src/index.ts";

type IsAssignable<Source, Target> = [Source] extends [Target] ? true : false;
type AssertFalse<Value extends false> = Value;

type MismatchedResourceRequest = {
	readonly method: "resources/read";
	readonly params: { readonly name: "not-a-resource-uri" };
};

/** Proves the default public union retains the method/params correlation. */
export type ProtocolRequestRejectsMismatchedParams = AssertFalse<
	IsAssignable<MismatchedResourceRequest, McpClientProtocolRequest>
>;

/** Proves an explicitly unioned method parameter stays a discriminated union. */
export type ProtocolRequestUnionRejectsMismatchedParams = AssertFalse<
	IsAssignable<MismatchedResourceRequest, McpClientProtocolRequest<"resources/read" | "tools/call">>
>;

declare const runtime: McpClientRuntime;

const completeToolResult = runtime.callTool("upstream", { name: "echo" });
const manualToolResult = runtime.callTool(
	"upstream",
	{ name: "echo" },
	{ allowInputRequired: true },
);

/** Proves normal tool calls retain the official complete-result contract. */
export type CallToolCompleteResult = AssertFalse<
	IsAssignable<InputRequiredResult, Awaited<typeof completeToolResult>>
>;

/** Proves manual tool calls expose the continuation in their public result. */
export type CallToolManualResult = AssertFalse<
	IsAssignable<
		Awaited<typeof manualToolResult>,
		Exclude<CallToolResult | InputRequiredResult, InputRequiredResult>
	>
>;

export function protocolRequestCompileTests(): void {
	void runtime.request("upstream", {
		method: "resources/read",
		// @ts-expect-error resources/read requires params.uri, never tools/call-style params.name.
		params: { name: "not-a-resource-uri" },
	});
}

createMcpClientPassthroughMiddleware(async (_operation, next) => {
	await next();
});

// @ts-expect-error Passthrough middleware cannot replace a method-specific client result.
createMcpClientPassthroughMiddleware(async () => ({ tools: [] }));
