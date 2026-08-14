import { All, Inject, Req, Res } from "@nestjs/common";
import { toNodeHandler } from "@modelcontextprotocol/node";
import type {
	FetchLikeMcpHandler,
	NodeIncomingMessageLike,
	NodeMcpRequestHandler,
	NodeServerResponseLike,
	ToNodeHandlerOptions,
} from "@modelcontextprotocol/node";
import type { AuthInfo } from "@modelcontextprotocol/server";
import type { McpServerRuntime } from "@nestm/mcp-server";
import { McpRuntimeService } from "./mcp-runtime.service.ts";

/** Builds the fetch handler mounted by a Nest HTTP controller. */
export type McpHttpHandlerFactory = (runtime: McpServerRuntime) => FetchLikeMcpHandler;

export interface McpHttpControllerOptions {
	/**
	 * Optionally wrap the named runtime before it is mounted.
	 *
	 * Use this seam for the framework-neutral `withMcpBearerAuth()` and
	 * `withMcpRequestValidation()` wrappers. Returning the runtime unchanged is
	 * equivalent to omitting the factory.
	 */
	readonly handler?: McpHttpHandlerFactory;
	/** Error observation for failures in the Node/Web request conversion layer. */
	readonly nodeAdapter?: Readonly<ToNodeHandlerOptions>;
}

/** Constructor returned by {@link McpHttpControllerFor}. */
export type McpHttpControllerClass = abstract new () => McpHttpController;

/**
 * Nest-native HTTP entry point for a named MCP server runtime.
 *
 * Extend this class through {@link McpHttpControllerFor}, then put `@Controller`
 * and any guards, interceptors, or version metadata on the concrete subclass.
 * The inherited catch-all route deliberately leaves HTTP method semantics to
 * the MCP handler.
 */
export abstract class McpHttpController {
	@Inject(McpRuntimeService)
	private readonly runtimeService!: McpRuntimeService;

	protected get mcpServerName(): string {
		throw new TypeError(
			"MCP HTTP controller must bind a named server through McpHttpControllerFor().",
		);
	}

	#nodeHandler: NodeMcpRequestHandler | undefined;

	@All()
	async handleMcpRequest(
		@Req() request: unknown,
		@Res({ passthrough: true }) response: unknown,
	): Promise<unknown> {
		const intercepted = this.interceptMcpRequest(request, response);
		if (intercepted !== undefined) return intercepted;
		const nodeRequest = toNodeRequest(request);
		const nodeResponse = toNodeResponse(response);
		forwardValidatedAuth(request, nodeRequest);
		hijackFastifyReply(response, nodeResponse);
		await this.#getNodeHandler()(nodeRequest, nodeResponse, parsedBodyOf(request));
		return undefined;
	}

	/**
	 * Optional Nest-native interception seam before the Node/Web adapter takes ownership.
	 * Returning a value short-circuits MCP dispatch and lets Nest serialize that value;
	 * returning `undefined` delegates to the named MCP runtime.
	 */
	protected interceptMcpRequest(_request: unknown, _response: unknown): unknown {
		return undefined;
	}

	/** Override to compose another fetch-shaped facade around the named runtime. */
	protected createMcpHttpHandler(runtime: McpServerRuntime): FetchLikeMcpHandler {
		return runtime;
	}

	/** Override to observe conversion-layer failures handled as HTTP 500 responses. */
	protected getNodeAdapterOptions(): Readonly<ToNodeHandlerOptions> | undefined {
		return undefined;
	}

	#getNodeHandler(): NodeMcpRequestHandler {
		this.#nodeHandler ??= toNodeHandler(
			this.createMcpHttpHandler(this.runtimeService.server(this.mcpServerName)),
			this.getNodeAdapterOptions(),
		);
		return this.#nodeHandler;
	}
}

/**
 * Creates a controller base bound to one named `McpRuntimeService` server.
 *
 * @example
 * ```ts
 * const ArtifactMcpControllerBase = McpHttpControllerFor("artifact");
 *
 * @Controller({ path: "mcp", version: "1" })
 * @UseGuards(ArtifactGuard)
 * export class ArtifactMcpController extends ArtifactMcpControllerBase {}
 * ```
 */
export function McpHttpControllerFor(
	serverName: string,
	options: McpHttpControllerOptions = {},
): McpHttpControllerClass {
	if (typeof serverName !== "string" || serverName.trim().length === 0) {
		throw new TypeError("MCP HTTP controller server name must be a non-empty string.");
	}
	const handlerFactory = options.handler;
	const nodeAdapterOptions =
		options.nodeAdapter === undefined ? undefined : Object.freeze({ ...options.nodeAdapter });

	abstract class NamedMcpHttpController extends McpHttpController {
		protected override get mcpServerName(): string {
			return serverName;
		}

		protected override createMcpHttpHandler(runtime: McpServerRuntime): FetchLikeMcpHandler {
			return handlerFactory?.(runtime) ?? runtime;
		}

		protected override getNodeAdapterOptions(): Readonly<ToNodeHandlerOptions> | undefined {
			return nodeAdapterOptions;
		}
	}

	return NamedMcpHttpController;
}

interface RawCarrier {
	readonly raw: unknown;
}

interface BodyCarrier {
	readonly body: unknown;
}

interface FastifyReplyLike extends RawCarrier {
	hijack(): unknown;
}

function toNodeRequest(request: unknown): NodeIncomingMessageLike {
	const candidate = hasRaw(request) ? request.raw : request;
	if (!isNodeRequest(candidate)) {
		throw new TypeError("Nest MCP HTTP controller requires a Node-compatible HTTP request.");
	}
	return candidate;
}

function toNodeResponse(response: unknown): NodeServerResponseLike {
	const candidate = hasRaw(response) ? response.raw : response;
	if (!isNodeResponse(candidate)) {
		throw new TypeError("Nest MCP HTTP controller requires a Node-compatible HTTP response.");
	}
	return candidate;
}

function parsedBodyOf(request: unknown): unknown {
	return hasBody(request) ? request.body : undefined;
}

function hijackFastifyReply(response: unknown, rawResponse: NodeServerResponseLike): void {
	if (!isFastifyReply(response) || response.raw !== rawResponse) return;
	response.hijack();
}

function forwardValidatedAuth(request: unknown, rawRequest: NodeIncomingMessageLike): void {
	if (request === rawRequest || !isObject(request) || rawRequest.auth !== undefined) return;
	const auth = Reflect.get(request, "auth");
	if (isAuthInfo(auth)) rawRequest.auth = auth;
}

function isAuthInfo(value: unknown): value is AuthInfo {
	if (!isObject(value)) return false;
	const token = Reflect.get(value, "token");
	const clientId = Reflect.get(value, "clientId");
	const scopes = Reflect.get(value, "scopes");
	const expiresAt = Reflect.get(value, "expiresAt");
	const resource = Reflect.get(value, "resource");
	const extra = Reflect.get(value, "extra");
	return (
		typeof token === "string" &&
		typeof clientId === "string" &&
		Array.isArray(scopes) &&
		scopes.every((scope) => typeof scope === "string") &&
		(expiresAt === undefined || typeof expiresAt === "number") &&
		(resource === undefined || resource instanceof URL) &&
		(extra === undefined || isObject(extra))
	);
}

function hasRaw(value: unknown): value is RawCarrier {
	return isObject(value) && "raw" in value;
}

function hasBody(value: unknown): value is BodyCarrier {
	return isObject(value) && "body" in value;
}

function isFastifyReply(value: unknown): value is FastifyReplyLike {
	return hasRaw(value) && typeof Reflect.get(value, "hijack") === "function";
}

function isNodeRequest(value: unknown): value is NodeIncomingMessageLike {
	return (
		isObject(value) &&
		isObject(Reflect.get(value, "headers")) &&
		typeof Reflect.get(value, Symbol.asyncIterator) === "function"
	);
}

function isNodeResponse(value: unknown): value is NodeServerResponseLike {
	return (
		isObject(value) &&
		typeof Reflect.get(value, "writeHead") === "function" &&
		typeof Reflect.get(value, "write") === "function" &&
		typeof Reflect.get(value, "end") === "function" &&
		typeof Reflect.get(value, "on") === "function"
	);
}

function isObject(value: unknown): value is object {
	return typeof value === "object" && value !== null;
}
