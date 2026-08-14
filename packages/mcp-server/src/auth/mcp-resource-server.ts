import {
	getOAuthProtectedResourceMetadataUrl,
	oauthMetadataResponse,
	requireBearerAuth,
} from "@modelcontextprotocol/server";
import type {
	AuthMetadataOptions,
	BearerAuthOptions,
	McpHandlerRequestOptions,
	ServerEventBus,
	ServerNotifier,
} from "@modelcontextprotocol/server";

export interface McpFetchHandler {
	fetch(request: Request, options?: McpHandlerRequestOptions): Promise<Response>;
	close(): Promise<void>;
	readonly notify: ServerNotifier;
	readonly bus: ServerEventBus;
}

export interface McpResourceServerOptions {
	readonly bearerAuth: BearerAuthOptions;
	readonly metadata?: AuthMetadataOptions;
}

/**
 * OAuth resource-server facade around an MCP HTTP handler.
 *
 * It serves RFC 9728/RFC 8414 discovery when configured, validates bearer tokens before MCP
 * dispatch, and passes the resulting `AuthInfo` into the official handler context.
 */
export class McpResourceServer implements McpFetchHandler {
	readonly notify: ServerNotifier;
	readonly bus: ServerEventBus;

	readonly #handler: McpFetchHandler;
	readonly #metadata: AuthMetadataOptions | undefined;
	readonly #authorize: ReturnType<typeof requireBearerAuth>;

	constructor(handler: McpFetchHandler, options: McpResourceServerOptions) {
		this.#handler = handler;
		this.#metadata = options.metadata;
		const resourceMetadataUrl =
			options.bearerAuth.resourceMetadataUrl ??
			(options.metadata === undefined
				? undefined
				: getOAuthProtectedResourceMetadataUrl(options.metadata.resourceServerUrl));
		this.#authorize = requireBearerAuth({
			...options.bearerAuth,
			...(resourceMetadataUrl === undefined ? {} : { resourceMetadataUrl }),
		});
		this.notify = handler.notify;
		this.bus = handler.bus;
	}

	async fetch(request: Request, options?: McpHandlerRequestOptions): Promise<Response> {
		const metadataResponse =
			this.#metadata === undefined ? undefined : oauthMetadataResponse(request, this.#metadata);
		if (metadataResponse !== undefined) return metadataResponse;

		const authorization = await this.#authorize(request);
		if (authorization instanceof Response) return authorization;
		return this.#handler.fetch(request, { ...options, authInfo: authorization });
	}

	close(): Promise<void> {
		return this.#handler.close();
	}
}
