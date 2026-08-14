import {
	hostHeaderValidationResponse,
	originValidationResponse,
} from "@modelcontextprotocol/server";
import type { McpHandlerRequestOptions } from "@modelcontextprotocol/server";
import type { McpFetchHandler } from "../auth/mcp-resource-server.ts";

export interface McpRequestValidationOptions {
	/** Hostnames only; do not include ports or schemes. */
	readonly allowedHostnames: readonly string[];
	/** Origin hostnames only. A missing Origin header is accepted by the official validator. */
	readonly allowedOriginHostnames: readonly string[];
}

/** Adds explicit Host and Origin validation before an MCP fetch handler. */
export class McpValidatedServer implements McpFetchHandler {
	readonly notify: McpFetchHandler["notify"];
	readonly bus: McpFetchHandler["bus"];

	readonly #handler: McpFetchHandler;
	readonly #allowedHostnames: string[];
	readonly #allowedOriginHostnames: string[];

	constructor(handler: McpFetchHandler, options: McpRequestValidationOptions) {
		this.#handler = handler;
		this.#allowedHostnames = normalizeAllowlist(options.allowedHostnames, "allowedHostnames");
		this.#allowedOriginHostnames = normalizeAllowlist(
			options.allowedOriginHostnames,
			"allowedOriginHostnames",
		);
		this.notify = handler.notify;
		this.bus = handler.bus;
	}

	fetch(request: Request, options?: McpHandlerRequestOptions): Promise<Response> {
		const rejection =
			hostHeaderValidationResponse(request, this.#allowedHostnames) ??
			originValidationResponse(request, this.#allowedOriginHostnames);
		return rejection === undefined
			? this.#handler.fetch(request, options)
			: Promise.resolve(rejection);
	}

	close(): Promise<void> {
		return this.#handler.close();
	}
}

function normalizeAllowlist(values: readonly string[], field: string): string[] {
	if (values.length === 0) throw new TypeError(`${field} cannot be empty.`);
	return values.map((value, index) => {
		const normalized = value.trim().toLowerCase();
		if (normalized.length === 0) {
			throw new TypeError(`${field}[${String(index)}] cannot be empty.`);
		}
		if (normalized.includes("://") || normalized.includes("/")) {
			throw new TypeError(
				`${field}[${String(index)}] must be a hostname without a scheme or path.`,
			);
		}
		return normalized;
	});
}
