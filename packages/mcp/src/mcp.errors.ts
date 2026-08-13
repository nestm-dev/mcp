export type McpModuleErrorCode =
	| "DUPLICATE_HANDLER"
	| "INVALID_HANDLER"
	| "INVALID_OPTIONS"
	| "INVALID_SCOPE"
	| "RUNTIME_NOT_READY"
	| "UNKNOWN_CLIENT"
	| "UNKNOWN_GATEWAY";

export class McpModuleError extends Error {
	constructor(
		readonly code: McpModuleErrorCode,
		message: string,
		options?: ErrorOptions,
	) {
		super(message, options);
		this.name = "McpModuleError";
	}
}
