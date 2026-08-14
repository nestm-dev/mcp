import { createMcpPassthroughMiddleware } from "@nestm/mcp-core";

import type {
	McpGatewayMiddleware,
	McpGatewayOperationContext,
	McpGatewayOperationInput,
	McpGatewayOperationOutput,
	McpGatewayPassthroughMiddleware,
} from "./mcp-gateway.types.ts";

/**
 * Creates gateway middleware that returns the exact downstream result. The
 * callback can run before and after `next()`, but the result remains opaque so
 * it cannot accidentally cross operation-discriminator boundaries.
 */
export function createMcpGatewayPassthroughMiddleware(
	middleware: McpGatewayPassthroughMiddleware,
): McpGatewayMiddleware {
	return createMcpPassthroughMiddleware<
		McpGatewayOperationInput,
		McpGatewayOperationOutput,
		McpGatewayOperationContext
	>(middleware);
}
