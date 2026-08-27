import { ProtocolError, ProtocolErrorCode, type Tool } from "@modelcontextprotocol/client";
import type { McpClientConnectionSnapshot, McpClientRuntimeOptions } from "@nestm/mcp-client";
import type { McpLifecycleObserver } from "@nestm/mcp-core";
import { afterEach, describe, expect, it, vi } from "vitest";

interface ControlledRuntimeInstance {
	readonly options: McpClientRuntimeOptions;
	readonly ping: ReturnType<typeof vi.fn>;
	readonly discover: ReturnType<typeof vi.fn>;
	readonly listTools: ReturnType<typeof vi.fn>;
	readonly listResources: ReturnType<typeof vi.fn>;
	readonly listResourceTemplates: ReturnType<typeof vi.fn>;
	readonly listPrompts: ReturnType<typeof vi.fn>;
	readonly callTool: ReturnType<typeof vi.fn>;
	connected: boolean;
	protocolEra: "legacy" | "modern";
	connectFailure: unknown;
}

const runtimeHarness = vi.hoisted(() => ({
	instances: [] as ControlledRuntimeInstance[],
	constructorFailure: undefined as unknown,
	callToolHook: undefined as ((signal: AbortSignal | undefined) => Promise<unknown>) | undefined,
}));

vi.mock("@nestm/mcp-client", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@nestm/mcp-client")>();
	class ControlledRuntime {
		readonly options: McpClientRuntimeOptions;
		readonly ping = vi.fn(async () => ({}));
		readonly discover = vi.fn(async () => ({}));
		readonly listTools = vi.fn(async () => ({ tools: [] }));
		readonly listResources = vi.fn(async () => ({ resources: [] }));
		readonly listResourceTemplates = vi.fn(async () => ({ resourceTemplates: [] }));
		readonly listPrompts = vi.fn(async () => ({ prompts: [] }));
		readonly callTool = vi.fn(
			async (_name: string, _request: unknown, options?: { readonly signal?: AbortSignal }) => {
				if (runtimeHarness.callToolHook !== undefined) {
					return runtimeHarness.callToolHook(options?.signal);
				}
				return { content: [] };
			},
		);
		readonly readResource = vi.fn(async () => ({ contents: [] }));
		readonly getPrompt = vi.fn(async () => ({ messages: [] }));
		connected = false;
		protocolEra: "legacy" | "modern" = "modern";
		connectFailure: unknown;

		constructor(options: McpClientRuntimeOptions = {}) {
			if (runtimeHarness.constructorFailure !== undefined) {
				throw runtimeHarness.constructorFailure;
			}
			this.options = options;
			runtimeHarness.instances.push(this);
		}

		async connect(): Promise<void> {
			if (this.connectFailure !== undefined) throw this.connectFailure;
			this.connected = true;
		}

		snapshot(name: string): McpClientConnectionSnapshot {
			return {
				name,
				state: this.connected ? "connected" : "disconnected",
				transportKind: "http",
				...(this.connected ? { connectedAt: 1 } : {}),
				negotiatedProtocolVersion: "2025-11-25",
				protocolEra: this.protocolEra,
				serverCapabilities: {
					tools: {},
					resources: { subscribe: true },
					prompts: {},
					completions: {},
				},
			};
		}

		async close(): Promise<void> {
			this.connected = false;
		}
	}
	return { ...actual, McpClientRuntime: ControlledRuntime };
});

import {
	McpRuntimeManager,
	mcpRuntimeCapabilitiesSnapshotSchema,
	mcpRuntimeProbeSnapshotSchema,
	mcpRuntimeStateSnapshotSchema,
	type McpAdmittedRuntimeGeneration,
	type McpRuntimeGenerationResolver,
	type McpRuntimeStateTransitionEvent,
} from "../src/index.ts";

describe("McpRuntimeManager", () => {
	afterEach(() => {
		runtimeHarness.instances.length = 0;
		runtimeHarness.constructorFailure = undefined;
		runtimeHarness.callToolHook = undefined;
		vi.restoreAllMocks();
	});

	it("deduplicates creation and shares one shutdown settlement", async () => {
		const allowResolve = deferred();
		const allowClose = deferred();
		const close = vi.fn(async () => allowClose.promise);
		const resolver = resolverFrom(async () => {
			await allowResolve.promise;
			return admitted(close);
		});
		const manager = new McpRuntimeManager({ generationResolver: resolver, maxConnections: 1 });

		const firstOnline = manager.ensureOnline("generation-one");
		const secondOnline = manager.ensureOnline("generation-one");
		await vi.waitFor(() => expect(resolver.resolve).toHaveBeenCalledOnce());
		allowResolve.resolve();
		await expect(Promise.all([firstOnline, secondOnline])).resolves.toHaveLength(2);
		expect(runtimeHarness.instances).toHaveLength(1);
		expect(manager.snapshot()).toMatchObject({
			connectionCount: 1,
			onlineKeeperCount: 1,
		});

		const firstClose = manager.close();
		const secondClose = manager.close();
		expect(firstClose).toBe(secondClose);
		await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
		allowClose.resolve();
		await expect(firstClose).resolves.toBeUndefined();
	});

	it("retains failed cleanup as quarantined capacity", async () => {
		const cleanupFailure = new Error("controlled cleanup failure");
		const resolver = resolverFrom(async () => admitted(async () => Promise.reject(cleanupFailure)));
		const manager = new McpRuntimeManager({ generationResolver: resolver, maxConnections: 1 });

		await manager.ensureOnline("generation-one");
		await expect(manager.setOffline("generation-one")).resolves.toMatchObject({
			phase: "quarantined",
			errorCode: "MCP_CLEANUP_FAILED",
		});
		expect(manager.snapshot()).toMatchObject({
			connectionCount: 1,
			quarantinedConnectionCount: 1,
		});
		await expect(manager.ensureOnline("generation-one")).rejects.toMatchObject({
			code: "MCP_QUARANTINED",
		});
		await expect(manager.ensureOnline("generation-two")).rejects.toMatchObject({
			code: "MCP_CAPACITY_EXCEEDED",
		});
		expect(resolver.resolve).toHaveBeenCalledOnce();
		await expect(manager.close()).rejects.toBeInstanceOf(AggregateError);
	});

	it("closes admitted material when runtime construction fails", async () => {
		const constructionFailure = new Error("controlled constructor failure");
		const close = vi.fn(async () => undefined);
		runtimeHarness.constructorFailure = constructionFailure;
		const manager = new McpRuntimeManager({
			generationResolver: resolverFrom(async () => admitted(close)),
		});

		await expect(manager.ensureOnline("generation-one")).rejects.toMatchObject({
			code: "MCP_UPSTREAM_FAILED",
		});
		expect(close).toHaveBeenCalledOnce();
		expect(manager.snapshot().connectionCount).toBe(0);
		await manager.close();
	});

	it("bounds a hung admitted cleanup and quarantines its capacity", async () => {
		const neverCloses = vi.fn(() => new Promise<void>(() => undefined));
		const manager = new McpRuntimeManager({
			generationResolver: resolverFrom(async () => admitted(neverCloses)),
			maxConnections: 1,
			shutdownTimeoutMs: 5,
		});
		await manager.ensureOnline("generation-one");

		await expect(manager.setOffline("generation-one")).resolves.toMatchObject({
			phase: "quarantined",
			errorCode: "MCP_CLEANUP_FAILED",
		});
		expect(manager.snapshot()).toMatchObject({
			connectionCount: 1,
			quarantinedConnectionCount: 1,
		});
		await expect(manager.close()).rejects.toBeInstanceOf(AggregateError);
	});

	it("does not quarantine a successfully drained in-flight connection failure", async () => {
		const allowResolutionFailure = deferred();
		const resolverFailure = new Error("controlled resolution failure");
		const resolver = resolverFrom(async () => {
			await allowResolutionFailure.promise;
			throw resolverFailure;
		});
		const manager = new McpRuntimeManager({ generationResolver: resolver, maxConnections: 1 });
		const online = manager.ensureOnline("generation-one");
		const onlineSettlement = online.catch((error: unknown) => error);
		await vi.waitFor(() => expect(resolver.resolve).toHaveBeenCalledOnce());

		const offline = manager.setOffline("generation-one");
		allowResolutionFailure.resolve();
		await expect(offline).resolves.toMatchObject({ phase: "offline" });
		expect(await onlineSettlement).toBeDefined();
		expect(manager.snapshot()).toMatchObject({
			connectionCount: 0,
			quarantinedConnectionCount: 0,
		});
		await manager.close();
	});

	it("shares concurrent offline work and queues reconnect until drain settles", async () => {
		const allowFirstClose = deferred();
		const firstClose = vi.fn(async () => allowFirstClose.promise);
		let resolutionCount = 0;
		const resolver = resolverFrom(async () => {
			resolutionCount += 1;
			return admitted(resolutionCount === 1 ? firstClose : async () => undefined);
		});
		const manager = new McpRuntimeManager({ generationResolver: resolver, maxConnections: 1 });
		await manager.ensureOnline("generation-one");

		const firstOffline = manager.setOffline("generation-one");
		const secondOffline = manager.setOffline("generation-one");
		expect(secondOffline).toBe(firstOffline);
		await vi.waitFor(() => expect(firstClose).toHaveBeenCalledOnce());
		const reconnect = manager.ensureOnline("generation-one");
		await Promise.resolve();
		expect(resolver.resolve).toHaveBeenCalledOnce();
		expect(runtimeHarness.instances).toHaveLength(1);

		allowFirstClose.resolve();
		await expect(Promise.all([firstOffline, secondOffline])).resolves.toEqual([
			expect.objectContaining({ phase: "offline" }),
			expect.objectContaining({ phase: "offline" }),
		]);
		await expect(reconnect).resolves.toMatchObject({ phase: "online" });
		expect(resolver.resolve).toHaveBeenCalledTimes(2);
		expect(runtimeHarness.instances).toHaveLength(2);
		expect(manager.snapshot().onlineKeeperCount).toBe(1);
		await manager.close();
	});

	it("rejects transient acquisitions while the same generation is draining", async () => {
		const allowClose = deferred();
		const close = vi.fn(async () => allowClose.promise);
		const resolver = resolverFrom(async () => admitted(close));
		const manager = new McpRuntimeManager({ generationResolver: resolver, maxConnections: 1 });
		await manager.ensureOnline("generation-one");
		const offline = manager.setOffline("generation-one");
		await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());

		await expect(manager.probe("generation-one")).rejects.toMatchObject({
			code: "MCP_NOT_READY",
		});
		expect(resolver.resolve).toHaveBeenCalledOnce();
		expect(runtimeHarness.instances).toHaveLength(1);
		allowClose.resolve();
		await expect(offline).resolves.toMatchObject({ phase: "offline" });
		await manager.close();
	});

	it("rechecks a new offline barrier before a queued reconnect starts", async () => {
		const allowFirstClose = deferred();
		let secondOfflineCompleted = false;
		let secondResolutionObservedOffline = false;
		let resolutionCount = 0;
		const resolver = resolverFrom(async () => {
			resolutionCount += 1;
			if (resolutionCount === 2) {
				secondResolutionObservedOffline = secondOfflineCompleted;
			}
			return admitted(resolutionCount === 1 ? async () => allowFirstClose.promise : undefined);
		});
		const manager = new McpRuntimeManager({ generationResolver: resolver, maxConnections: 1 });
		await manager.ensureOnline("generation-one");
		const firstOffline = manager.setOffline("generation-one");
		let secondOffline: Promise<unknown> | undefined;
		void firstOffline.then(() => {
			secondOffline = manager.setOffline("generation-one").then((state) => {
				secondOfflineCompleted = true;
				return state;
			});
		});
		const reconnect = manager.ensureOnline("generation-one");

		allowFirstClose.resolve();
		await firstOffline;
		await vi.waitFor(() => expect(secondOffline).toBeDefined());
		await secondOffline;
		await expect(reconnect).resolves.toMatchObject({ phase: "online" });
		expect(secondResolutionObservedOffline).toBe(true);
		expect(manager.state("generation-one").phase).toBe("online");
		expect(manager.snapshot().onlineKeeperCount).toBe(1);
		await manager.close();
	});

	it("publishes transitions only after lifecycle barriers are registered", async () => {
		const resolver = resolverFrom(async () => admitted());
		const manager = new McpRuntimeManager({ generationResolver: resolver, maxConnections: 1 });
		let reentrantOnline: Promise<unknown> | undefined;
		let reentrantOffline: Promise<unknown> | undefined;
		manager.subscribe((event) => {
			if (event.phase === "queued") {
				reentrantOnline = manager.ensureOnline("generation-one");
			}
			if (event.phase === "draining") {
				reentrantOffline = manager.setOffline("generation-one");
			}
		});

		await manager.ensureOnline("generation-one");
		await expect(reentrantOnline).resolves.toMatchObject({ phase: "online" });
		expect(resolver.resolve).toHaveBeenCalledOnce();
		const offline = manager.setOffline("generation-one");
		await vi.waitFor(() => expect(reentrantOffline).toBe(offline));
		await expect(offline).resolves.toMatchObject({ phase: "offline" });
		await manager.close();
	});

	it("aborts in-flight work when its generation starts draining", async () => {
		const operationStarted = deferred();
		runtimeHarness.callToolHook = async (signal) => {
			if (signal === undefined) throw new Error("The operation signal is required.");
			operationStarted.resolve();
			await rejectWhenAborted(signal);
		};
		const manager = new McpRuntimeManager({
			generationResolver: resolverFrom(async () => admitted()),
		});
		await manager.ensureOnline("generation-one");
		const operation = manager.callTool("generation-one", "controlled", {});
		await operationStarted.promise;

		const offline = manager.setOffline("generation-one");
		await expect(operation).rejects.toMatchObject({ code: "MCP_GENERATION_RETIRED" });
		await expect(offline).resolves.toMatchObject({ phase: "offline" });
		await manager.close();
	});

	it("keeps a positional abort signal as the cancellation-only tool call option", async () => {
		const operationStarted = deferred();
		runtimeHarness.callToolHook = async (signal) => {
			if (signal === undefined) throw new Error("The operation signal is required.");
			operationStarted.resolve();
			await rejectWhenAborted(signal);
		};
		const manager = new McpRuntimeManager({
			generationResolver: resolverFrom(async () => admitted()),
		});
		await manager.ensureOnline("generation-one");
		const ownedRuntime = runtimeHarness.instances[0]!;
		const actualServerName = ownedRuntime.options.servers?.[0]?.name;
		if (actualServerName === undefined) throw new Error("The managed server name is required.");
		const caller = new AbortController();
		const callerCancellation = new Error("caller cancelled managed tool call");

		const operation = manager.callTool(
			"generation-one",
			"controlled",
			{ value: "kept" },
			caller.signal,
		);
		await operationStarted.promise;

		expect(ownedRuntime.callTool).toHaveBeenCalledWith(
			actualServerName,
			{ name: "controlled", arguments: { value: "kept" } },
			{ signal: expect.any(AbortSignal) },
		);
		caller.abort(callerCancellation);
		await expect(operation).rejects.toBe(callerCancellation);
		await manager.close();
	});

	it("pins a caller-supplied tool definition on the managed client runtime call", async () => {
		const manager = new McpRuntimeManager({
			generationResolver: resolverFrom(async () => admitted()),
		});
		await manager.ensureOnline("generation-one");
		const ownedRuntime = runtimeHarness.instances[0]!;
		const actualServerName = ownedRuntime.options.servers?.[0]?.name;
		if (actualServerName === undefined) throw new Error("The managed server name is required.");
		const caller = new AbortController();
		const toolDefinition = Object.freeze({
			name: "controlled",
			inputSchema: {
				type: "object" as const,
				properties: { value: { type: "string" as const } },
				required: ["value"],
			},
		}) satisfies Tool;

		await expect(
			manager.callTool(
				"generation-one",
				"controlled",
				{ value: "kept" },
				{ signal: caller.signal, toolDefinition },
			),
		).resolves.toMatchObject({ content: [] });

		expect(ownedRuntime.callTool).toHaveBeenCalledWith(
			actualServerName,
			{ name: "controlled", arguments: { value: "kept" } },
			{ signal: expect.any(AbortSignal), toolDefinition },
		);
		await manager.close();
	});

	it("rejects tool call options that are neither a signal nor an options object", async () => {
		const manager = new McpRuntimeManager({
			generationResolver: resolverFrom(async () => admitted()),
		});
		await manager.ensureOnline("generation-one");
		const ownedRuntime = runtimeHarness.instances[0]!;

		await expect(
			manager.callTool(
				"generation-one",
				"controlled",
				{},
				// Intentionally models malformed JavaScript input at the runtime boundary.
				// oxlint-disable-next-line typescript/no-unsafe-type-assertion
				"cancel" as unknown as AbortSignal,
			),
		).rejects.toMatchObject({
			name: "TypeError",
			message: "callTool options must be an AbortSignal or a tool call options object.",
		});
		expect(ownedRuntime.callTool).not.toHaveBeenCalled();
		await manager.close();
	});

	it("publishes state and probe snapshots that satisfy the exported validators", async () => {
		const manager = new McpRuntimeManager({
			generationResolver: resolverFrom(async () => admitted()),
		});
		const online = await manager.ensureOnline("generation-one");
		const probe = await manager.probe("generation-one");
		const untracked = manager.state("unknown-generation");

		expect(mcpRuntimeStateSnapshotSchema["~standard"].validate(online)).toEqual({ value: online });
		expect(mcpRuntimeStateSnapshotSchema["~standard"].validate(untracked)).toEqual({
			value: untracked,
		});
		expect(mcpRuntimeProbeSnapshotSchema["~standard"].validate(probe)).toEqual({ value: probe });
		expect(probe.capabilities).toBeDefined();
		expect(mcpRuntimeCapabilitiesSnapshotSchema["~standard"].validate(probe.capabilities)).toEqual({
			value: probe.capabilities,
		});

		runtimeHarness.instances[0]!.connected = false;
		const degraded = manager.state("generation-one");
		expect(degraded).toMatchObject({ phase: "degraded", errorCode: "MCP_CONNECTION_LOST" });
		expect(mcpRuntimeStateSnapshotSchema["~standard"].validate(degraded)).toEqual({
			value: degraded,
		});

		const offline = await manager.setOffline("generation-one");
		expect(mcpRuntimeStateSnapshotSchema["~standard"].validate(offline)).toEqual({
			value: offline,
		});
		await manager.close();
	});

	it("exposes the owned runtime identity and preserves caller-bound tool call options", async () => {
		const operationStarted = deferred();
		runtimeHarness.callToolHook = async (signal) => {
			if (signal === undefined) throw new Error("The operation signal is required.");
			operationStarted.resolve();
			await rejectWhenAborted(signal);
		};
		const manager = new McpRuntimeManager({
			generationResolver: resolverFrom(async () => admitted()),
		});
		await manager.ensureOnline("generation-one");
		const ownedRuntime = runtimeHarness.instances[0]!;
		const actualServerName = ownedRuntime.options.servers?.[0]?.name;
		if (actualServerName === undefined) throw new Error("The managed server name is required.");
		const caller = new AbortController();
		const callerCancellation = new Error("caller cancelled managed operation");
		const toolDefinition = Object.freeze({
			name: "controlled",
			inputSchema: {
				type: "object" as const,
				properties: { value: { type: "string" as const } },
				required: ["value"],
			},
		}) satisfies Tool;
		let operationSignal: AbortSignal | undefined;

		const operation = manager.withClientRuntime(
			"generation-one",
			async (context) => {
				operationSignal = context.signal;
				expect(context.runtime).toBe(ownedRuntime);
				expect(context.serverName).toBe(actualServerName);
				return context.runtime.callTool(
					context.serverName,
					{ name: toolDefinition.name, arguments: { value: "preserved" } },
					{
						signal: context.signal,
						toolDefinition,
						allowInputRequired: true,
					},
				);
			},
			caller.signal,
		);
		await operationStarted.promise;

		expect(actualServerName).toMatch(/^managed-/);
		expect(actualServerName).not.toBe("generation-one");
		expect(operationSignal).toBeDefined();
		expect(ownedRuntime.callTool).toHaveBeenCalledWith(
			actualServerName,
			{ name: "controlled", arguments: { value: "preserved" } },
			{
				signal: operationSignal,
				toolDefinition,
				allowInputRequired: true,
			},
		);

		caller.abort(callerCancellation);
		await expect(operation).rejects.toBe(callerCancellation);
		expect(operationSignal).toMatchObject({ aborted: true, reason: callerCancellation });
		await manager.close();
	});

	it("keeps withClientRuntime tool calls bound to generation retirement", async () => {
		const operationStarted = deferred();
		runtimeHarness.callToolHook = async (signal) => {
			if (signal === undefined) throw new Error("The operation signal is required.");
			operationStarted.resolve();
			await rejectWhenAborted(signal);
		};
		const manager = new McpRuntimeManager({
			generationResolver: resolverFrom(async () => admitted()),
		});
		await manager.ensureOnline("generation-one");
		let operationSignal: AbortSignal | undefined;

		const operation = manager.withClientRuntime("generation-one", async (context) => {
			operationSignal = context.signal;
			return context.runtime.callTool(
				context.serverName,
				{ name: "controlled", arguments: {} },
				{ signal: context.signal, allowInputRequired: true },
			);
		});
		await operationStarted.promise;

		const offline = manager.setOffline("generation-one");
		await expect(operation).rejects.toMatchObject({ code: "MCP_GENERATION_RETIRED" });
		expect(operationSignal).toMatchObject({ aborted: true });
		await expect(offline).resolves.toMatchObject({ phase: "offline" });
		await manager.close();
	});

	it("preserves an explicit caller cancellation reason", async () => {
		const manager = new McpRuntimeManager({
			generationResolver: resolverFrom(async () => admitted()),
		});
		await manager.ensureOnline("generation-one");
		const controller = new AbortController();
		const cancellation = new Error("caller cancelled");
		controller.abort(cancellation);

		await expect(manager.probe("generation-one", controller.signal)).rejects.toBe(cancellation);
		await manager.close();
	});

	it("bounds retained failed state across unique generation keys", async () => {
		const manager = new McpRuntimeManager({
			generationResolver: resolverFrom(async () => Promise.reject(new Error("unavailable"))),
			maxConnections: 1,
			maxStateEntries: 2,
		});
		for (let index = 1; index <= 5; index += 1) {
			await expect(manager.ensureOnline(`failed-${String(index)}`)).rejects.toBeInstanceOf(Error);
		}

		expect(manager.state("failed-1").phase).toBe("offline");
		expect(manager.state("failed-4").phase).toBe("failed");
		expect(manager.state("failed-5").phase).toBe("failed");
		await manager.close();
	});

	it("does not evict an owned runtime state for a capacity-failing key", async () => {
		const manager = new McpRuntimeManager({
			generationResolver: resolverFrom(async () => admitted()),
			maxConnections: 1,
			maxStateEntries: 1,
		});
		await manager.ensureOnline("owned-generation");

		await expect(manager.ensureOnline("capacity-failing-generation")).rejects.toMatchObject({
			code: "MCP_CAPACITY_EXCEEDED",
		});
		expect(manager.state("owned-generation").phase).toBe("online");
		expect(manager.state("capacity-failing-generation").phase).toBe("offline");
		await manager.close();
	});

	it("reconciles an unexpectedly disconnected keeper as degraded on read", async () => {
		const manager = new McpRuntimeManager({
			generationResolver: resolverFrom(async () => admitted()),
		});
		await manager.ensureOnline("generation-one");
		expect(manager.state("generation-one").phase).toBe("online");

		runtimeHarness.instances[0]!.connected = false;
		expect(manager.state("generation-one")).toMatchObject({
			phase: "degraded",
			errorCode: "MCP_CONNECTION_LOST",
		});
		await manager.close();
	});

	it("keeps a failed reconnect with an owned keeper as protected degraded state", async () => {
		const manager = new McpRuntimeManager({
			generationResolver: resolverFrom(async () => admitted()),
			maxConnections: 1,
			maxStateEntries: 1,
		});
		await manager.ensureOnline("owned-generation");
		const runtime = runtimeHarness.instances[0]!;
		runtime.connected = false;
		runtime.connectFailure = new Error("controlled reconnect failure");

		await expect(manager.ensureOnline("owned-generation")).rejects.toMatchObject({
			code: "MCP_UPSTREAM_FAILED",
		});
		expect(manager.state("owned-generation")).toMatchObject({
			phase: "degraded",
			errorCode: "MCP_UPSTREAM_FAILED",
		});
		await expect(manager.ensureOnline("capacity-failing-generation")).rejects.toMatchObject({
			code: "MCP_CAPACITY_EXCEEDED",
		});
		expect(manager.state("owned-generation").phase).toBe("degraded");
		await manager.close();
	});

	it("falls back from an out-of-range diagnostics clock", async () => {
		const manager = new McpRuntimeManager({
			generationResolver: resolverFrom(async () => admitted()),
			now: () => Number.MAX_VALUE,
		});

		expect(() => manager.state("unknown-generation")).not.toThrow();
		expect(Date.parse(manager.state("unknown-generation").lastTransitionAt)).not.toBeNaN();
		await manager.close();
	});

	it("pings legacy generations instead of using modern discovery", async () => {
		const manager = new McpRuntimeManager({
			generationResolver: resolverFrom(async () => admitted()),
		});
		await manager.ensureOnline("legacy-generation");
		const runtime = runtimeHarness.instances[0]!;
		runtime.protocolEra = "legacy";

		await expect(manager.probe("legacy-generation")).resolves.toMatchObject({
			reachable: true,
			protocolVersion: "2025-11-25",
			protocolEra: "legacy",
			capabilities: {
				tools: true,
				resources: true,
				prompts: true,
				completion: true,
				subscriptions: true,
			},
		});
		await expect(manager.refreshCatalog("legacy-generation")).resolves.toMatchObject({
			tools: [],
			resources: [],
			resourceTemplates: [],
			prompts: [],
		});
		expect(runtime.discover).not.toHaveBeenCalled();
		expect(runtime.ping).toHaveBeenCalledTimes(2);
		expect(runtime.listTools).toHaveBeenCalledOnce();
		expect(runtime.listResources).toHaveBeenCalledOnce();
		expect(runtime.listResourceTemplates).toHaveBeenCalledOnce();
		expect(runtime.listPrompts).toHaveBeenCalledOnce();
		await manager.close();
	});

	it("treats only protocol method-not-found from optional template discovery as empty", async () => {
		const manager = new McpRuntimeManager({
			generationResolver: resolverFrom(async () => admitted()),
		});
		await manager.ensureOnline("template-optional-generation");
		const runtime = runtimeHarness.instances[0]!;
		runtime.listTools.mockResolvedValueOnce({
			tools: [{ name: "search", inputSchema: { type: "object" } }],
		});
		runtime.listResourceTemplates.mockRejectedValueOnce(
			new ProtocolError(ProtocolErrorCode.MethodNotFound, "Method not found"),
		);

		await expect(manager.refreshCatalog("template-optional-generation")).resolves.toMatchObject({
			tools: [{ name: "search" }],
			resources: [],
			resourceTemplates: [],
			prompts: [],
		});

		const invalidParams = new ProtocolError(
			ProtocolErrorCode.InvalidParams,
			"Invalid template request",
		);
		runtime.listResourceTemplates.mockRejectedValueOnce(invalidParams);
		await expect(manager.refreshCatalog("template-optional-generation")).rejects.toMatchObject({
			code: "MCP_UPSTREAM_FAILED",
			cause: invalidParams,
		});
		await manager.close();
	});

	it("publishes bounded key-free state events and allows unsubscription", async () => {
		const events: McpRuntimeStateTransitionEvent[] = [];
		const listenerError = vi.fn();
		const manager = new McpRuntimeManager({
			generationResolver: resolverFrom(async () => admitted()),
			now: () => 1_700_000_000_000,
			onListenerError: listenerError,
		});
		const unsubscribe = manager.subscribe((event) => {
			events.push(event);
		});
		manager.subscribe(() => {
			throw new Error("diagnostic failure");
		});

		await expect(manager.ensureOnline("secret-generation-key")).resolves.toMatchObject({
			phase: "online",
		});
		expect(listenerError).toHaveBeenCalled();
		expect(events.map((event) => event.phase)).toEqual(["queued", "connecting", "online"]);
		for (const event of events) {
			expect(JSON.stringify(event)).not.toContain("secret-generation-key");
			expect(Object.keys(event)).not.toContain("generationKey");
		}

		unsubscribe();
		const eventCount = events.length;
		await manager.setOffline("secret-generation-key");
		expect(events).toHaveLength(eventCount);
		await manager.close();
	});

	it("passes one observer to every runtime without using generation keys as targets", async () => {
		const observer: McpLifecycleObserver = { onEvent: vi.fn() };
		const manager = new McpRuntimeManager({
			generationResolver: resolverFrom(async () => admitted()),
			maxConnections: 2,
			observer,
		});
		await manager.ensureOnline("customer-a:generation-1");
		await manager.ensureOnline("customer-b:generation-9");

		expect(runtimeHarness.instances).toHaveLength(2);
		for (const [index, runtime] of runtimeHarness.instances.entries()) {
			expect(runtime.options.observer).toBe(observer);
			const serverName = runtime.options.servers?.[0]?.name;
			expect(serverName).toMatch(/^managed-/);
			expect(serverName).not.toBe(
				index === 0 ? "customer-a:generation-1" : "customer-b:generation-9",
			);
		}
		await manager.close();
	});

	it("preserves host resolver failures for application-level error mapping", async () => {
		const hostError = Object.assign(new Error("retired by the host"), {
			code: "MCP_GENERATION_RETIRED",
			status: 409,
		});
		const manager = new McpRuntimeManager({
			generationResolver: resolverFrom(async () => Promise.reject(hostError)),
		});

		await expect(manager.ensureOnline("retired-generation")).rejects.toBe(hostError);
		expect(manager.state("retired-generation")).toMatchObject({
			phase: "failed",
			errorCode: "MCP_GENERATION_RETIRED",
		});
		await manager.close();
	});
});

function resolverFrom(
	resolve: (generationKey: string, signal: AbortSignal) => Promise<McpAdmittedRuntimeGeneration>,
): McpRuntimeGenerationResolver & { readonly resolve: ReturnType<typeof vi.fn> } {
	return { resolve: vi.fn(resolve) };
}

function admitted(
	close: () => Promise<void> = async () => undefined,
): McpAdmittedRuntimeGeneration {
	return Object.freeze({
		transport: Object.freeze({ kind: "http" as const, url: "https://mcp.example.test" }),
		close,
	});
}

function deferred(): { readonly promise: Promise<void>; resolve(): void } {
	let settle: (() => void) | undefined;
	const promise = new Promise<void>((resolve) => {
		settle = resolve;
	});
	return Object.freeze({
		promise,
		resolve(): void {
			settle?.();
		},
	});
}

function rejectWhenAborted(signal: AbortSignal): Promise<never> {
	if (signal.aborted) return Promise.reject(signal.reason);
	return new Promise<never>((_resolve, reject) => {
		signal.addEventListener("abort", () => reject(signal.reason), { once: true });
	});
}
