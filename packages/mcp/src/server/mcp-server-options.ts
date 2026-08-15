import type { CreateMcpHandlerOptions, ServerOptions } from "@modelcontextprotocol/server";
import { McpModuleError } from "../mcp.errors.ts";
import { McpProviderRegistry, mcpProviderTokenName } from "../mcp-provider.registry.ts";
import type { McpProviderToken } from "../mcp-provider.types.ts";
import type { McpNestServerHttpOptions, McpNestServerOptions } from "./mcp-server.types.ts";

export function resolveMcpNestServerOptions(
	options: McpNestServerOptions | undefined,
	providers: McpProviderRegistry,
): ServerOptions | undefined {
	if (options === undefined) return undefined;
	const { jsonSchemaValidator, requestState, ...data } = options;
	return {
		...data,
		...(jsonSchemaValidator === undefined
			? {}
			: {
					jsonSchemaValidator: requireMethodProvider(
						providers,
						jsonSchemaValidator,
						"getValidator",
					),
				}),
		...(requestState === undefined
			? {}
			: {
					requestState:
						requestState.verifier === undefined
							? {}
							: {
									verify: bindProviderMethod(providers, requestState.verifier, "verify"),
								},
				}),
	};
}

export function resolveMcpNestServerHttpOptions(
	options: McpNestServerHttpOptions | undefined,
	providers: McpProviderRegistry,
): Omit<CreateMcpHandlerOptions, "onerror"> | undefined {
	if (options === undefined) return undefined;
	const { eventBus, ...data } = options;
	discardProperties(data, ["bus", "onerror"]);
	return {
		...data,
		...(eventBus === undefined
			? {}
			: {
					bus: requireMethodProvider(providers, eventBus, ["publish", "subscribe"]),
				}),
	};
}

function requireProvider<Value>(
	providers: McpProviderRegistry,
	token: McpProviderToken<Value>,
): Value {
	const provider = providers.get(token);
	if ((typeof provider !== "object" && typeof provider !== "function") || provider === null) {
		throw new McpModuleError(
			"INVALID_OPTIONS",
			`MCP server collaborator ${mcpProviderTokenName(token)} must be listed in McpModule collaborators.providers.`,
		);
	}
	// Token typing and Nest's provider registration establish the public contract.
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion
	return provider as Value;
}

function requireMethodProvider<Value extends object, Method extends keyof Value>(
	providers: McpProviderRegistry,
	token: McpProviderToken<Value>,
	methods: Method | readonly Method[],
): Value & Record<Method, Extract<Value[Method], (...arguments_: never[]) => unknown>> {
	const provider = requireProvider(providers, token);
	const requiredMethods = Array.isArray(methods) ? methods : [methods];
	if (requiredMethods.some((method) => typeof Reflect.get(provider, method) !== "function")) {
		throw new McpModuleError(
			"INVALID_OPTIONS",
			`MCP server collaborator ${mcpProviderTokenName(token)} must implement ${requiredMethods
				.map((method) => `${String(method)}()`)
				.join(", ")}.`,
		);
	}
	// Runtime validation above narrows the configured method to a callable.
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion
	return provider as Value &
		Record<Method, Extract<Value[Method], (...arguments_: never[]) => unknown>>;
}

function bindProviderMethod<Value extends object, Method extends keyof Value>(
	providers: McpProviderRegistry,
	token: McpProviderToken<Value>,
	method: Method,
): Extract<Value[Method], (...arguments_: never[]) => unknown> {
	const provider = requireMethodProvider(providers, token, method);
	// Function.bind() loses the indexed-access relationship; the validated method keeps it.
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion
	return provider[method].bind(provider) as Extract<
		Value[Method],
		(...arguments_: never[]) => unknown
	>;
}

function discardProperties(value: object, properties: readonly PropertyKey[]): void {
	for (const property of properties) Reflect.deleteProperty(value, property);
}
