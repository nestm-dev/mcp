import { Injectable } from "@nestjs/common";
import {
	composeMcpMiddleware,
	createMcpAuthorizationMiddleware,
	createMcpLifecycleMiddleware,
	createMcpOperation,
	createMcpOperationContext,
} from "@nestm/mcp-core";
import type { McpOperationHandler } from "@nestm/mcp-core";
import type {
	McpServer,
	McpServerFeature,
	McpServerPrincipal,
	ServerContext,
} from "@nestm/mcp-server";
import { McpModuleError } from "../mcp.errors.ts";
import type {
	McpHandlerAuthorizationPolicy,
	McpHandlerInvocationInput,
	McpHandlerLifecycleObserver,
	McpHandlerMiddleware,
	McpHandlerOperationContext,
} from "../mcp.types.ts";
import type { McpHandlerDefinition } from "../decorators/mcp-handler.decorators.ts";

export type McpDiscoveredHandler = (...arguments_: unknown[]) => unknown;

interface RegisteredHandler {
	readonly definition: McpHandlerDefinition;
	readonly handler: McpDiscoveredHandler;
	readonly source: string;
}

interface McpHandlerPipelineOptions {
	readonly serverName: string;
	readonly authorization?: McpHandlerAuthorizationPolicy;
	readonly middleware?: readonly McpHandlerMiddleware[];
	readonly lifecycleObserver?: McpHandlerLifecycleObserver;
}

@Injectable()
export class McpHandlerRegistry {
	readonly #handlers: RegisteredHandler[] = [];

	register(definition: McpHandlerDefinition, handler: McpDiscoveredHandler, source: string): void {
		this.#handlers.push({ definition, handler, source });
	}

	list(): readonly RegisteredHandler[] {
		return [...this.#handlers];
	}

	assertNoCollisions(runtimeName: string): void {
		const seen = new Map<string, string>();
		for (const entry of this.#handlers) {
			if (!targetsRuntime(entry.definition.options.servers, runtimeName)) continue;
			const key = registrationKey(entry.definition);
			const previous = seen.get(key);
			if (previous !== undefined) {
				throw new McpModuleError(
					"DUPLICATE_HANDLER",
					`Duplicate MCP ${entry.definition.kind} registration "${key}" for server "${runtimeName}" from ${previous} and ${entry.source}.`,
				);
			}
			seen.set(key, entry.source);
		}
	}

	/** Whether discovery found any decorated handler targeting one runtime. */
	hasHandlersFor(runtimeName: string): boolean {
		return this.#handlers.some((entry) =>
			targetsRuntime(entry.definition.options.servers, runtimeName),
		);
	}

	asServerFeature(options: McpHandlerPipelineOptions): McpServerFeature {
		const snapshot = [...this.#handlers];
		return (server, context) => {
			for (const entry of snapshot) {
				if (!targetsRuntime(entry.definition.options.servers, context.runtimeName)) continue;
				registerHandler(server, entry, options, context.principal);
			}
		};
	}
}

function targetsRuntime(
	targets: string | readonly string[] | undefined,
	runtimeName: string,
): boolean {
	return (
		targets === undefined ||
		(typeof targets === "string" ? targets === runtimeName : targets.includes(runtimeName))
	);
}

function registrationKey(definition: McpHandlerDefinition): string {
	if (definition.kind === "resource" && typeof definition.options.uri === "string") {
		return `${definition.kind}:${definition.options.uri}`;
	}
	return `${definition.kind}:${definition.options.name}`;
}

function registerHandler(
	server: McpServer,
	entry: RegisteredHandler,
	options: McpHandlerPipelineOptions,
	principal: McpServerPrincipal | undefined,
): void {
	const callback = (...arguments_: unknown[]): Promise<unknown> =>
		invokeHandler(entry, arguments_, options, principal);
	if (entry.definition.kind === "tool") {
		const { name, servers: _servers, ...config } = entry.definition.options;
		const registerTool = server.registerTool.bind(server);
		Reflect.apply(registerTool, undefined, [name, config, callback]);
		return;
	}
	if (entry.definition.kind === "prompt") {
		const { name, servers: _servers, ...config } = entry.definition.options;
		const registerPrompt = server.registerPrompt.bind(server);
		Reflect.apply(registerPrompt, undefined, [name, config, callback]);
		return;
	}
	const { name, uri, servers: _servers, ...config } = entry.definition.options;
	const registerResource = server.registerResource.bind(server);
	Reflect.apply(registerResource, undefined, [name, uri, config, callback]);
}

async function invokeHandler(
	entry: RegisteredHandler,
	callbackArguments: readonly unknown[],
	options: McpHandlerPipelineOptions,
	principal: McpServerPrincipal | undefined,
): Promise<unknown> {
	const sdkContext = callbackArguments.at(-1);
	if (!isServerContext(sdkContext)) {
		throw new McpModuleError(
			"INVALID_HANDLER",
			`MCP ${entry.definition.kind} handler ${entry.source} received no official server context.`,
		);
	}

	const input = Object.freeze({
		kind: entry.definition.kind,
		name: entry.definition.options.name,
		serverName: options.serverName,
		source: entry.source,
		arguments: snapshotHandlerArguments(callbackArguments.slice(0, -1)),
	}) satisfies McpHandlerInvocationInput;
	const requestId = String(sdkContext.mcpReq.id);
	const context = createMcpOperationContext({
		operationId: crypto.randomUUID(),
		role: "server",
		operation: {
			name: sdkContext.mcpReq.method,
			kind: "request",
			capability: capability(entry.definition.kind),
			target: options.serverName,
			attributes: {
				"mcp.handler.kind": entry.definition.kind,
				"mcp.handler.name": entry.definition.options.name,
				"mcp.transport": sdkContext.http?.req === undefined ? "stdio" : "http",
			},
		},
		signal: sdkContext.mcpReq.signal,
		requestId,
		...(sdkContext.sessionId === undefined ? {} : { sessionId: sdkContext.sessionId }),
		...(principal === undefined ? {} : { principal }),
	}) satisfies McpHandlerOperationContext;
	const operation = createMcpOperation(input, context);
	const terminal: McpOperationHandler<
		McpHandlerInvocationInput,
		unknown,
		McpHandlerOperationContext
	> = () => entry.handler(...callbackArguments);
	const middleware: McpHandlerMiddleware[] = [];
	if (options.lifecycleObserver !== undefined) {
		middleware.push(createMcpLifecycleMiddleware(options.lifecycleObserver));
	}
	if (options.authorization !== undefined) {
		middleware.push(createMcpAuthorizationMiddleware(options.authorization));
	}
	middleware.push(...(options.middleware ?? []));
	return composeMcpMiddleware(middleware, terminal)(operation);
}

function snapshotHandlerArguments(values: readonly unknown[]): readonly unknown[] {
	return Object.freeze(
		values.map((value) => {
			let clone: unknown;
			try {
				clone = value instanceof URL ? new URL(value.href) : structuredClone(value);
			} catch (cause) {
				throw new McpModuleError(
					"INVALID_HANDLER",
					"Validated MCP handler arguments must be snapshot-safe before authorization.",
					{ cause },
				);
			}
			return freezePolicyValue(clone);
		}),
	);
}

function freezePolicyValue(value: unknown): unknown {
	if (Array.isArray(value)) {
		for (const entry of value) freezePolicyValue(entry);
		return Object.freeze(value);
	}
	if (isPlainRecord(value)) {
		for (const entry of Object.values(value)) freezePolicyValue(entry);
		return Object.freeze(value);
	}
	return value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	if (typeof value !== "object" || value === null) return false;
	const prototype = Object.getPrototypeOf(value) as unknown;
	return prototype === Object.prototype || prototype === null;
}

function isServerContext(value: unknown): value is ServerContext {
	if (typeof value !== "object" || value === null || !("mcpReq" in value)) return false;
	const request = value.mcpReq;
	return (
		typeof request === "object" &&
		request !== null &&
		"id" in request &&
		"method" in request &&
		typeof request.method === "string" &&
		"signal" in request &&
		request.signal instanceof AbortSignal
	);
}

function capability(kind: McpHandlerInvocationInput["kind"]): string {
	if (kind === "tool") return "tools";
	if (kind === "resource") return "resources";
	return "prompts";
}
