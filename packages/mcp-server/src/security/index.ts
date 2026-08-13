export { McpValidatedServer, withMcpRequestValidation } from "./mcp-request-validation.ts";
export type { McpRequestValidationOptions } from "./mcp-request-validation.ts";

export {
	hostHeaderValidationResponse,
	localhostAllowedHostnames,
	localhostAllowedOrigins,
	originValidationResponse,
	validateHostHeader,
	validateOriginHeader,
} from "@modelcontextprotocol/server";
export type {
	HostHeaderValidationResult,
	OriginValidationResult,
} from "@modelcontextprotocol/server";
