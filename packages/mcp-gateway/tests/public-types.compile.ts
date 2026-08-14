import type { CallToolResult } from "@nestm/mcp-server";

import {
	createMcpGatewayPassthroughMiddleware,
	type McpGatewayDiscoverySnapshot,
	type McpGatewayInvocationOperationInput,
	type McpGatewayOperationOutputFor,
} from "../src/index.ts";

type IsAssignable<Source, Target> = [Source] extends [Target] ? true : false;
type AssertFalse<Value extends false> = Value;
type AssertTrue<Value extends true> = Value;

type InvocationOutput = McpGatewayOperationOutputFor<McpGatewayInvocationOperationInput>;

/** Proves the operation discriminator selects the invocation result contract. */
export type InvocationOutputIsCallToolResult = AssertTrue<
	IsAssignable<InvocationOutput, CallToolResult>
>;

/** Proves discovery output cannot cross the invocation discriminator boundary. */
export type InvocationOutputRejectsDiscovery = AssertFalse<
	IsAssignable<McpGatewayDiscoverySnapshot, InvocationOutput>
>;

createMcpGatewayPassthroughMiddleware(async (_operation, next) => {
	await next();
});

// @ts-expect-error Passthrough middleware cannot replace a discriminator-specific result.
createMcpGatewayPassthroughMiddleware(async () => ({ content: [] }));
