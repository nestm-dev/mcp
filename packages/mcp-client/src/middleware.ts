import { createMcpPassthroughMiddleware } from "@nestm/mcp-core";

import type {
	McpClientMiddleware,
	McpClientOperationContext,
	McpClientOperationInput,
	McpClientPassthroughMiddleware,
} from "./types.ts";

/**
 * Creates client middleware that always returns the exact downstream result.
 * The callback can run before and after `next()`, but cannot inspect, replace,
 * or swallow a method-specific result.
 */
export function createMcpClientPassthroughMiddleware<Principal = unknown>(
	middleware: McpClientPassthroughMiddleware<Principal>,
): McpClientMiddleware<Principal> {
	return createMcpPassthroughMiddleware<
		McpClientOperationInput,
		unknown,
		McpClientOperationContext<Principal>
	>(middleware);
}
