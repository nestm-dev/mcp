import { Inject, Injectable, Module, Scope, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
	Client,
	InMemoryTransport,
	StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import {
	ResourceTemplate,
	UriTemplate,
	completable,
	fromJsonSchema,
} from "@modelcontextprotocol/server";
import { allowMcpOperation } from "@nestm/mcp-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
	McpModule,
	McpRuntimeService,
	McpServerRuntime,
	McpTool,
	acceptedContent,
	allowAllMcpGatewayPolicy,
	inputRequired,
} from "../src/index.ts";
import type {
	CallToolResult,
	InputRequiredResult,
	McpGatewayClientResolver,
	ServerContext,
} from "../src/index.ts";
import { createMcpServerTestFetch } from "../src/testing/index.ts";

const MCP_TEST_CONFIGURATION = Symbol("MCP_TEST_CONFIGURATION");

@Module({
	providers: [{ provide: MCP_TEST_CONFIGURATION, useValue: "async-server" }],
	exports: [MCP_TEST_CONFIGURATION],
})
class McpTestConfigurationModule {}

@Injectable()
class McpRuntimeConsumer {
	constructor(readonly runtime: McpRuntimeService) {}
}

@Injectable()
class FeatureImportedToolsProvider {
	constructor(@Inject(MCP_TEST_CONFIGURATION) private readonly configuration: string) {}

	@McpTool({ name: "feature.imported", servers: "feature-imports" })
	readConfiguration() {
		return { content: [{ type: "text" as const, text: this.configuration }] };
	}
}

@Module({ providers: [McpRuntimeConsumer], exports: [McpRuntimeConsumer] })
class McpSiblingConsumerModule {}

@Injectable()
class ToolsProvider {
	@McpTool({
		name: "greet",
		servers: "artifact",
		description: "Greet an agent",
		inputSchema: fromJsonSchema<{ name: string }>({
			type: "object",
			properties: { name: { type: "string" } },
			required: ["name"],
		}),
	})
	greet({ name }: { name: string }) {
		return { content: [{ type: "text" as const, text: `Hello ${name}` }] };
	}
}

@Injectable({ scope: Scope.REQUEST })
class RequestScopedToolsProvider {
	@McpTool({ name: "unsafe.request-scoped" })
	call() {
		return { content: [{ type: "text" as const, text: "unsafe" }] };
	}
}

const confirmationSchema = fromJsonSchema<{ confirm: boolean }>({
	type: "object",
	properties: { confirm: { type: "boolean" } },
	required: ["confirm"],
});

@Injectable()
class InteractiveToolsProvider {
	@McpTool({
		name: "publish",
		servers: "interactive",
		inputSchema: fromJsonSchema<Record<string, never>>({
			type: "object",
			properties: {},
			additionalProperties: false,
		}),
	})
	publish(
		_arguments: Record<string, never>,
		context: ServerContext,
	): CallToolResult | InputRequiredResult {
		const confirmation = acceptedContent(
			context.mcpReq.inputResponses,
			"confirm",
			confirmationSchema,
		);
		if (confirmation?.confirm === true) {
			return { content: [{ type: "text", text: "published" }] };
		}
		return inputRequired({
			inputRequests: {
				confirm: inputRequired.elicit({
					message: "Publish?",
					requestedSchema: confirmationSchema,
				}),
			},
		});
	}
}

describe("McpModule", () => {
	let client: Client | undefined;
	let application: INestApplication | undefined;
	let upstream: McpServerRuntime | undefined;

	afterEach(async () => {
		await client?.close();
		await application?.close();
		await upstream?.close();
	});

	it("supports async injected configuration and local-module extras", async () => {
		const factory = vi.fn((serverName: string) => ({
			autoDiscover: false,
			servers: [{ name: serverName, serverInfo: { name: serverName, version: "1.0.0" } }],
		}));
		const dynamicModule = McpModule.forRootAsync({
			isGlobal: false,
			imports: [McpTestConfigurationModule],
			inject: [MCP_TEST_CONFIGURATION],
			useFactory: factory,
		});
		expect(dynamicModule.global).toBe(false);
		const testingModule = await Test.createTestingModule({ imports: [dynamicModule] }).compile();
		application = testingModule.createNestApplication();
		await application.init();

		const runtime = application.get(McpRuntimeService);
		expect(runtime.server("async-server").name).toBe("async-server");
		expect(factory).toHaveBeenCalledWith("async-server");
		expect(McpModule.forRoot().global).toBe(true);
	});

	it("honors global and local module visibility", async () => {
		await expect(
			Test.createTestingModule({
				imports: [McpModule.forRoot({ isGlobal: false }), McpSiblingConsumerModule],
			}).compile(),
		).rejects.toThrow(/McpRuntimeService/);

		const testingModule = await Test.createTestingModule({
			imports: [McpModule.forRoot(), McpSiblingConsumerModule],
		}).compile();
		application = testingModule.createNestApplication();
		await application.init();
		expect(application.get(McpRuntimeConsumer).runtime).toBe(application.get(McpRuntimeService));
	});

	it("forwards feature imports and honors explicit exports", async () => {
		const feature = McpModule.forFeature({
			imports: [McpTestConfigurationModule],
			providers: [FeatureImportedToolsProvider],
			exports: [],
		});
		expect(feature.imports).toEqual([McpTestConfigurationModule]);
		expect(feature.exports).toEqual([]);
		const testingModule = await Test.createTestingModule({
			imports: [
				McpModule.forRoot({
					servers: [
						{
							name: "feature-imports",
							serverInfo: { name: "feature-imports", version: "1.0.0" },
						},
					],
				}),
				feature,
			],
		}).compile();
		application = testingModule.createNestApplication();
		await application.init();
		client = new Client(
			{ name: "feature-imports-test", version: "1.0.0" },
			{ versionNegotiation: { mode: "auto" } },
		);
		await client.connect(
			new StreamableHTTPClientTransport(new URL("http://feature.test/mcp"), {
				fetch: createMcpServerTestFetch(
					application.get(McpRuntimeService).server("feature-imports"),
				),
			}),
		);

		const result = await client.callTool({ name: "feature.imported", arguments: {} });

		expect(result.content).toEqual([{ type: "text", text: "async-server" }]);
	});

	it("discovers decorated providers and serves them through MCP v2", async () => {
		const authorize = vi.fn((operation) => {
			expect(operation.context.principal).toMatchObject({
				clientId: "artifact-agent",
				subject: "user-1",
				tenantId: "tenant-1",
			});
			return allowMcpOperation({ policy: "test" });
		});
		const lifecycle = vi.fn();
		const principalClaims = vi.fn(() => ({ subject: "user-1", tenantId: "tenant-1" }));
		const middleware = vi.fn(async (operation, next) => {
			const firstArgument = operation.input.arguments[0];
			expect(Object.isFrozen(firstArgument)).toBe(true);
			expect(Reflect.set(Object(firstArgument), "name", "Mallory")).toBe(false);
			return next();
		});
		const testingModule = await Test.createTestingModule({
			imports: [
				McpModule.forRoot({
					servers: [
						{
							name: "artifact",
							serverInfo: { name: "artifact", version: "1.0.0" },
							principalClaims,
							handlerAuthorization: { authorize },
							handlerMiddleware: [middleware],
							handlerLifecycleObserver: { onEvent: lifecycle },
						},
					],
				}),
			],
			providers: [ToolsProvider],
		}).compile();
		application = testingModule.createNestApplication();
		await application.init();
		const runtimeService = application.get(McpRuntimeService);
		expect(runtimeService.clients.size).toBe(0);
		expect(runtimeService.listGateways()).toEqual([]);
		expect(() => runtimeService.gateway("artifact")).toThrow(/No MCP gateway/);
		const runtime = runtimeService.server("artifact");
		client = new Client(
			{ name: "test", version: "1.0.0" },
			{ versionNegotiation: { mode: "auto" } },
		);
		await client.connect(
			new StreamableHTTPClientTransport(new URL("http://test.local/mcp"), {
				fetch: createMcpServerTestFetch(runtime, {
					authInfo: {
						token: "not-projected",
						clientId: "artifact-agent",
						scopes: ["artifacts:read"],
					},
				}),
			}),
		);

		const result = await client.callTool({ name: "greet", arguments: { name: "Ada" } });

		expect(result.content).toEqual([{ type: "text", text: "Hello Ada" }]);
		expect(authorize).toHaveBeenCalledWith(
			expect.objectContaining({
				input: expect.objectContaining({
					kind: "tool",
					name: "greet",
					serverName: "artifact",
				}),
				context: expect.objectContaining({
					role: "server",
					operation: expect.objectContaining({ name: "tools/call" }),
				}),
			}),
		);
		expect(lifecycle.mock.calls.map(([event]) => event.type)).toEqual([
			"operation.started",
			"operation.succeeded",
		]);
		expect(middleware).toHaveBeenCalledOnce();
		expect(principalClaims).toHaveBeenCalledOnce();
	});

	it("rejects request-scoped decorated handlers during bootstrap", async () => {
		const testingModule = await Test.createTestingModule({
			imports: [
				McpModule.forRoot({
					servers: [
						{
							name: "unsafe",
							serverInfo: { name: "unsafe", version: "1.0.0" },
						},
					],
				}),
			],
			providers: [RequestScopedToolsProvider],
		}).compile();
		application = testingModule.createNestApplication();

		await expect(application.init()).rejects.toThrow(/singleton provider/);
	});

	it("runs authorization and lifecycle on every decorated multi-round input leg", async () => {
		const authorize = vi.fn(() => allowMcpOperation({ policy: "interactive-test" }));
		const lifecycle = vi.fn();
		const testingModule = await Test.createTestingModule({
			imports: [
				McpModule.forRoot({
					servers: [
						{
							name: "interactive",
							serverInfo: { name: "interactive", version: "1.0.0" },
							handlerAuthorization: { authorize },
							handlerLifecycleObserver: { onEvent: lifecycle },
						},
					],
				}),
			],
			providers: [InteractiveToolsProvider],
		}).compile();
		application = testingModule.createNestApplication();
		await application.init();
		client = new Client(
			{ name: "interactive-host", version: "1.0.0" },
			{
				capabilities: { elicitation: { form: {} } },
				versionNegotiation: { mode: "auto" },
				inputRequired: { maxRounds: 2 },
			},
		);
		client.setRequestHandler("elicitation/create", async () => ({
			action: "accept",
			content: { confirm: true },
		}));
		await client.connect(
			new StreamableHTTPClientTransport(new URL("http://interactive.test/mcp"), {
				fetch: createMcpServerTestFetch(application.get(McpRuntimeService).server("interactive")),
			}),
		);

		const result = await client.callTool({ name: "publish", arguments: {} });

		expect(result.content).toEqual([{ type: "text", text: "published" }]);
		expect(authorize).toHaveBeenCalledTimes(2);
		expect(lifecycle.mock.calls.map(([event]) => event.type)).toEqual([
			"operation.started",
			"operation.succeeded",
			"operation.started",
			"operation.succeeded",
		]);
	});

	it("builds an aggregate gateway from Nest-owned named clients", async () => {
		const upstreamRuntime = new McpServerRuntime({
			name: "knowledge",
			serverInfo: { name: "knowledge", version: "1.0.0" },
			features: [
				(server) => {
					server.registerTool(
						"search",
						{
							inputSchema: fromJsonSchema<{ query: string }>({
								type: "object",
								properties: { query: { type: "string" } },
								required: ["query"],
							}),
						},
						async ({ query }) => ({ content: [{ type: "text", text: `found:${query}` }] }),
					);
					server.registerResource(
						"guide",
						"docs://knowledge/guide",
						{ title: "Knowledge guide", mimeType: "text/plain" },
						async (uri) => ({
							contents: [{ uri: uri.href, mimeType: "text/plain", text: "gateway guide" }],
						}),
					);
					server.registerPrompt(
						"summarize",
						{
							description: "Summarize a topic",
							argsSchema: z.object({
								topic: completable(z.string(), (value) =>
									["MCP v2", "NestJS", "observability"].filter((entry) =>
										entry.toLowerCase().startsWith(value.toLowerCase()),
									),
								),
							}),
						},
						async ({ topic }) => ({
							messages: [
								{
									role: "user",
									content: { type: "text", text: `Summarize ${topic}` },
								},
							],
						}),
					);
					server.registerResource(
						"section",
						new ResourceTemplate("docs://knowledge/sections/{section}", {
							list: undefined,
							complete: {
								section: (value) =>
									["runtime", "security", "observability"].filter((entry) =>
										entry.startsWith(value),
									),
							},
						}),
						{ title: "Knowledge section", mimeType: "text/plain" },
						async (uri, { section }) => ({
							contents: [
								{
									uri: uri.href,
									mimeType: "text/plain",
									text: `section:${String(section)}`,
								},
							],
						}),
					);
				},
			],
		});
		upstream = upstreamRuntime;
		const testingModule = await Test.createTestingModule({
			imports: [
				McpModule.forRoot({
					clients: [
						{
							name: "knowledge",
							transport: { kind: "http", url: "http://knowledge.test/mcp" },
						},
					],
					clientRuntime: {
						transportFactory: {
							createTransport: () =>
								new StreamableHTTPClientTransport(new URL("http://knowledge.test/mcp"), {
									fetch: createMcpServerTestFetch(upstreamRuntime),
								}),
						},
					},
					connectClientsOnBootstrap: true,
					servers: [
						{
							name: "agent-gateway",
							serverInfo: { name: "agent-gateway", version: "1.0.0" },
							gateway: {
								upstreams: [{ clientName: "knowledge", gatewayName: "kb" }],
								policy: allowAllMcpGatewayPolicy(),
							},
						},
					],
				}),
			],
		}).compile();
		application = testingModule.createNestApplication();
		await application.init();
		const runtimeService = application.get(McpRuntimeService);
		const runtime = runtimeService.server("agent-gateway");
		expect(runtimeService.listGateways()).toEqual([runtimeService.gateway("agent-gateway")]);
		client = new Client(
			{ name: "agent", version: "1.0.0" },
			{ versionNegotiation: { mode: "auto" } },
		);
		await client.connect(
			new StreamableHTTPClientTransport(new URL("http://gateway.test/mcp"), {
				fetch: createMcpServerTestFetch(runtime),
			}),
		);

		const tools = await client.listTools();
		expect(tools.tools).toHaveLength(1);
		const result = await client.callTool({
			name: tools.tools[0]!.name,
			arguments: { query: "mcp" },
		});
		expect(result.content).toEqual([{ type: "text", text: "found:mcp" }]);

		const resources = await client.listResources();
		expect(resources.resources).toHaveLength(1);
		expect(resources.resources[0]!.uri).not.toBe("docs://knowledge/guide");
		const resource = await client.readResource({ uri: resources.resources[0]!.uri });
		expect(resource.contents).toEqual([
			{
				uri: resources.resources[0]!.uri,
				mimeType: "text/plain",
				text: "gateway guide",
			},
		]);

		const prompts = await client.listPrompts();
		expect(prompts.prompts).toHaveLength(1);
		expect(prompts.prompts[0]!.name).not.toBe("summarize");
		const prompt = await client.getPrompt({
			name: prompts.prompts[0]!.name,
			arguments: { topic: "MCP v2" },
		});
		expect(prompt.messages).toEqual([
			{
				role: "user",
				content: { type: "text", text: "Summarize MCP v2" },
			},
		]);

		const promptCompletion = await client.complete({
			ref: { type: "ref/prompt", name: prompts.prompts[0]!.name },
			argument: { name: "topic", value: "mcp" },
		});
		expect(promptCompletion.completion.values).toEqual(["MCP v2"]);

		const templates = await client.listResourceTemplates();
		expect(templates.resourceTemplates).toHaveLength(1);
		const template = templates.resourceTemplates[0]!;
		expect(template.uriTemplate).not.toBe("docs://knowledge/sections/{section}");
		const templateCompletion = await client.complete({
			ref: { type: "ref/resource", uri: template.uriTemplate },
			argument: { name: "section", value: "sec" },
		});
		expect(templateCompletion.completion.values).toEqual(["security"]);
		const projectedSectionUri = new UriTemplate(template.uriTemplate).expand({
			section: "runtime",
		});
		const section = await client.readResource({ uri: projectedSectionUri });
		expect(section.contents).toEqual([
			{
				uri: projectedSectionUri,
				mimeType: "text/plain",
				text: "section:runtime",
			},
		]);
	});

	it("passes a verified principal to a context-aware declarative gateway upstream", async () => {
		const resolvedPrincipals: unknown[] = [];
		const resolvedAuthTokens: unknown[] = [];
		const resolveClient: McpGatewayClientResolver = (context) => {
			resolvedPrincipals.push(context.principal);
			resolvedAuthTokens.push(context.authInfo?.token);
			return {
				listTools: () => ({
					tools: [
						{
							name: "whoami",
							inputSchema: { type: "object", additionalProperties: false },
						},
					],
				}),
				callTool: () => ({ content: [{ type: "text", text: "delegated" }] }),
			};
		};
		const testingModule = await Test.createTestingModule({
			imports: [
				McpModule.forRoot({
					servers: [
						{
							name: "delegated-gateway",
							serverInfo: { name: "delegated-gateway", version: "1.0.0" },
							principalClaims: () => ({ subject: "user-1", tenantId: "tenant-1" }),
							gateway: {
								upstreams: [{ name: "delegated", client: resolveClient }],
								policy: allowAllMcpGatewayPolicy(),
							},
						},
					],
				}),
			],
		}).compile();
		application = testingModule.createNestApplication();
		await application.init();
		client = new Client(
			{ name: "delegated-agent", version: "1.0.0" },
			{ versionNegotiation: { mode: "auto" } },
		);
		await client.connect(
			new StreamableHTTPClientTransport(new URL("http://delegated.test/mcp"), {
				fetch: createMcpServerTestFetch(
					application.get(McpRuntimeService).server("delegated-gateway"),
					{
						authInfo: {
							token: "never-forward",
							clientId: "artifact-agent",
							scopes: ["artifacts:read"],
						},
					},
				),
			}),
		);

		await client.listTools();

		expect(resolvedPrincipals[0]).toEqual({
			clientId: "artifact-agent",
			scopes: ["artifacts:read"],
			subject: "user-1",
			tenantId: "tenant-1",
		});
		// Full verified auth data is available only at the explicit resolver seam so
		// applications can exchange it; the projected principal remains token-free.
		expect(resolvedAuthTokens[0]).toBe("never-forward");
		expect(JSON.stringify(resolvedPrincipals)).not.toContain("never-forward");
	});

	it("fails bootstrap when a gateway references an unknown named client", async () => {
		const testingModule = await Test.createTestingModule({
			imports: [
				McpModule.forRoot({
					servers: [
						{
							name: "invalid-gateway",
							serverInfo: { name: "invalid-gateway", version: "1.0.0" },
							gateway: {
								upstreams: ["missing"],
								policy: allowAllMcpGatewayPolicy(),
							},
						},
					],
				}),
			],
		}).compile();
		application = testingModule.createNestApplication();

		await expect(application.init()).rejects.toThrow(/unknown MCP client "missing"/);
	});

	it("rejects decorated handlers on a dedicated gateway server during bootstrap", async () => {
		const testingModule = await Test.createTestingModule({
			imports: [
				McpModule.forRoot({
					servers: [
						{
							name: "artifact",
							serverInfo: { name: "artifact", version: "1.0.0" },
							gateway: {
								upstreams: [
									{
										name: "empty",
										client: {
											listTools: () => ({ tools: [] }),
											callTool: () => ({ content: [] }),
										},
									},
								],
								policy: allowAllMcpGatewayPolicy(),
							},
						},
					],
				}),
			],
			providers: [ToolsProvider],
		}).compile();
		application = testingModule.createNestApplication();

		await expect(application.init()).rejects.toThrow(/must be dedicated/);
	});

	it("closes inbound servers, then gateways, then their upstream clients", async () => {
		const testingModule = await Test.createTestingModule({
			imports: [
				McpModule.forRoot({
					servers: [
						{
							name: "gateway",
							serverInfo: { name: "gateway", version: "1.0.0" },
							gateway: {
								upstreams: [
									{
										name: "upstream",
										client: {
											listTools: () => ({ tools: [] }),
											callTool: () => ({ content: [] }),
										},
									},
								],
								policy: allowAllMcpGatewayPolicy(),
							},
						},
					],
				}),
			],
		}).compile();
		application = testingModule.createNestApplication();
		await application.init();
		const runtime = application.get(McpRuntimeService);
		const closed: string[] = [];
		vi.spyOn(runtime.servers, "close").mockImplementation(async () => {
			closed.push("servers");
		});
		vi.spyOn(runtime.gateway("gateway"), "close").mockImplementation(async () => {
			closed.push("gateway");
		});
		vi.spyOn(runtime.clients, "close").mockImplementation(async () => {
			closed.push("clients");
		});

		await application.close();
		application = undefined;

		expect(closed).toEqual(["servers", "gateway", "clients"]);
	});

	it("publishes one stable runtime close promise before child cleanup can re-enter", async () => {
		const testingModule = await Test.createTestingModule({
			imports: [McpModule.forRoot()],
		}).compile();
		application = testingModule.createNestApplication();
		await application.init();
		const runtime = application.get(McpRuntimeService);
		let reentrantClose: Promise<void> | undefined;
		vi.spyOn(runtime.servers, "close").mockImplementation(() => {
			reentrantClose = runtime.close();
			return Promise.resolve();
		});
		vi.spyOn(runtime.clients, "close").mockResolvedValue();

		const close = runtime.close();
		await close;

		expect(reentrantClose).toBe(close);
	});

	it("contains cleanup failures so Nest can finish disposing its adapters", async () => {
		const testingModule = await Test.createTestingModule({
			imports: [McpModule.forRoot()],
		}).compile();
		application = testingModule.createNestApplication();
		await application.init();
		const runtime = application.get(McpRuntimeService);
		const clientClose = vi.spyOn(runtime.clients, "close").mockResolvedValue();
		vi.spyOn(runtime.servers, "close").mockRejectedValue(new Error("server close failed"));

		await expect(application.close()).resolves.toBeUndefined();
		application = undefined;

		expect(clientClose).toHaveBeenCalledOnce();
		expect(runtime.shutdownError).toBeInstanceOf(AggregateError);
		expect(runtime.shutdownError?.errors).toEqual([
			expect.objectContaining({ message: "server close failed" }),
		]);
		await expect(runtime.close()).rejects.toBe(runtime.shutdownError);
	});

	it("rolls back a partially connected client set when bootstrap fails", async () => {
		const healthyServer = new McpServerRuntime({
			name: "healthy",
			serverInfo: { name: "healthy", version: "1.0.0" },
		});
		upstream = healthyServer;
		const healthyMcpServer = await healthyServer.createServer({ era: "modern" });
		let healthyClientTransport: InMemoryTransport | undefined;
		let healthyServerTransport: InMemoryTransport | undefined;
		let runtime: McpRuntimeService | undefined;
		let healthyWasConnected = false;
		const testingModule = await Test.createTestingModule({
			imports: [
				McpModule.forRoot({
					clients: [
						{ name: "healthy", transport: { kind: "http", url: "http://healthy.test/mcp" } },
						{ name: "broken", transport: { kind: "http", url: "http://broken.test/mcp" } },
					],
					clientRuntime: {
						transportFactory: {
							createTransport: async (definition) => {
								if (definition.kind !== "http") {
									throw new Error("Expected an HTTP test transport.");
								}
								if (String(definition.url).includes("broken")) {
									await vi.waitFor(() =>
										expect(runtime?.clients.snapshot("healthy").state).toBe("connected"),
									);
									healthyWasConnected = true;
									throw new Error("broken upstream");
								}
								[healthyClientTransport, healthyServerTransport] =
									InMemoryTransport.createLinkedPair();
								await healthyMcpServer.connect(healthyServerTransport);
								return healthyClientTransport;
							},
						},
					},
					connectClientsOnBootstrap: true,
				}),
			],
		}).compile();
		application = testingModule.createNestApplication();
		const initializedRuntime = application.get(McpRuntimeService);
		runtime = initializedRuntime;

		await expect(application.init()).rejects.toThrow("broken upstream");

		expect(healthyWasConnected).toBe(true);
		expect(initializedRuntime.clients.closed).toBe(true);
		expect(initializedRuntime.clients.snapshot().every(({ state }) => state !== "connected")).toBe(
			true,
		);
		expect(healthyClientTransport).toBeDefined();
		application = undefined;
		await healthyMcpServer.close();
	});
});
