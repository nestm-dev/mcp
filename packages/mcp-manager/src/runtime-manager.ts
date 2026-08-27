import {
	MCP_CLIENT_LEASE_INVALIDATED,
	McpClientLeaseManager,
	type CallToolResult,
	type GetPromptResult,
	type McpClientConnectionSnapshot,
	type McpClientLease,
	type ReadResourceResult,
} from "@nestm/mcp-client";
import { METHOD_NOT_FOUND, ProtocolError } from "@modelcontextprotocol/client";

import {
	MCP_RUNTIME_CLEANUP_FAILED,
	MCP_RUNTIME_CONNECTION_LOST,
	MCP_RUNTIME_DISCOVERY_LIMIT_EXCEEDED,
	MCP_RUNTIME_GENERATION_RETIRED,
	McpRuntimeManagerError,
	mapMcpRuntimeManagerError,
	runtimeManagerClosedError,
	runtimeManagerErrorCode,
	runtimeNotReadyError,
	runtimeQuarantinedError,
} from "./errors.ts";
import {
	ManagedRuntimeFactory,
	type ActiveMcpRuntime,
	type OwnedMcpRuntime,
} from "./runtime-factory.ts";
import { RuntimeStateStore } from "./runtime-state.ts";
import type {
	McpRuntimeCatalogSnapshot,
	McpManagedClientRuntimeOperation,
	McpRuntimeManagerOptions,
	McpRuntimeManagerPort,
	McpRuntimeManagerSnapshot,
	McpRuntimeProbeSnapshot,
	McpRuntimeStateListener,
	McpRuntimeStateSnapshot,
	McpRuntimeToolCallOptions,
} from "./types.ts";

export const MCP_RUNTIME_MANAGER_DEFAULTS = Object.freeze({
	maxConnections: 100,
	maxStateEntries: 1_000,
	requestTimeoutMs: 10_000,
	shutdownTimeoutMs: 30_000,
	maxDiscoveryPages: 16,
	maxDiscoveryItems: 1_000,
});

export class McpRuntimeManager<GenerationKey = string>
	implements McpRuntimeManagerPort<GenerationKey>, AsyncDisposable
{
	readonly #leases: McpClientLeaseManager<GenerationKey, OwnedMcpRuntime<GenerationKey>>;
	readonly #keepers = new Map<GenerationKey, McpClientLease<OwnedMcpRuntime<GenerationKey>>>();
	readonly #onlineTasks = new Map<GenerationKey, Promise<McpRuntimeStateSnapshot>>();
	readonly #offlineTasks = new Map<GenerationKey, Promise<McpRuntimeStateSnapshot>>();
	readonly #postOfflineOnlineTasks = new Map<GenerationKey, Promise<McpRuntimeStateSnapshot>>();
	readonly #states: RuntimeStateStore<GenerationKey>;
	readonly #requestTimeoutMs: number;
	readonly #maxDiscoveryItems: number;
	readonly #now: () => number;
	#closed = false;
	#closeTask: Promise<void> | undefined;

	constructor(options: McpRuntimeManagerOptions<GenerationKey>) {
		if (
			typeof options?.generationResolver !== "object" ||
			options.generationResolver === null ||
			typeof options.generationResolver.resolve !== "function"
		) {
			throw new TypeError("generationResolver.resolve must be a function.");
		}
		const maxConnections = positiveInteger(
			options.maxConnections ?? MCP_RUNTIME_MANAGER_DEFAULTS.maxConnections,
			"maxConnections",
		);
		const maxStateEntries = positiveInteger(
			options.maxStateEntries ??
				Math.max(MCP_RUNTIME_MANAGER_DEFAULTS.maxStateEntries, maxConnections),
			"maxStateEntries",
		);
		if (maxStateEntries < maxConnections) {
			throw new RangeError("maxStateEntries must be greater than or equal to maxConnections.");
		}
		this.#requestTimeoutMs = positiveFinite(
			options.requestTimeoutMs ?? MCP_RUNTIME_MANAGER_DEFAULTS.requestTimeoutMs,
			"requestTimeoutMs",
		);
		const shutdownTimeoutMs = positiveFinite(
			options.shutdownTimeoutMs ?? MCP_RUNTIME_MANAGER_DEFAULTS.shutdownTimeoutMs,
			"shutdownTimeoutMs",
		);
		const maxDiscoveryPages = positiveInteger(
			options.maxDiscoveryPages ?? MCP_RUNTIME_MANAGER_DEFAULTS.maxDiscoveryPages,
			"maxDiscoveryPages",
		);
		this.#maxDiscoveryItems = positiveInteger(
			options.maxDiscoveryItems ?? MCP_RUNTIME_MANAGER_DEFAULTS.maxDiscoveryItems,
			"maxDiscoveryItems",
		);
		if (options.observer !== undefined && typeof options.observer.onEvent !== "function") {
			throw new TypeError("observer.onEvent must be a function.");
		}
		this.#now = safeClock(options.now ?? Date.now);
		this.#states = new RuntimeStateStore({
			now: this.#now,
			maxEntries: maxStateEntries,
			...(options.onListenerError === undefined
				? {}
				: { onListenerError: options.onListenerError }),
		});
		const factory = new ManagedRuntimeFactory({
			generationResolver: options.generationResolver,
			states: this.#states,
			requestTimeoutMs: this.#requestTimeoutMs,
			shutdownTimeoutMs,
			maxDiscoveryPages,
			...(options.clientInfo === undefined ? {} : { clientInfo: options.clientInfo }),
			...(options.observer === undefined ? {} : { observer: options.observer }),
			now: this.#now,
		});
		this.#leases = new McpClientLeaseManager({
			maxResources: maxConnections,
			create: (generationKey, context) => factory.create(generationKey, context),
			close: (owned) => factory.close(owned),
		});
	}

	async ensureOnline(
		generationKey: GenerationKey,
		signal?: AbortSignal,
	): Promise<McpRuntimeStateSnapshot> {
		this.#assertOpen();
		const offlineTask = this.#offlineTasks.get(generationKey);
		if (offlineTask !== undefined) {
			let queued = this.#postOfflineOnlineTasks.get(generationKey);
			if (queued === undefined) {
				const created = this.#reconnectAfterOfflineBarriers(generationKey);
				queued = created;
				this.#postOfflineOnlineTasks.set(generationKey, created);
				void created.then(
					() => this.#deletePostOfflineOnlineTask(generationKey, created),
					() => this.#deletePostOfflineOnlineTask(generationKey, created),
				);
			}
			return waitForCaller(queued, signal);
		}
		this.#assertNotQuarantined(generationKey);
		return waitForCaller(this.#getOrCreateOnlineTask(generationKey), signal);
	}

	async #reconnectAfterOfflineBarriers(
		generationKey: GenerationKey,
	): Promise<McpRuntimeStateSnapshot> {
		for (;;) {
			const barrier = this.#offlineTasks.get(generationKey);
			if (barrier === undefined) break;
			await barrier;
		}
		this.#assertOpen();
		this.#assertNotQuarantined(generationKey);
		return this.#getOrCreateOnlineTask(generationKey);
	}

	#getOrCreateOnlineTask(generationKey: GenerationKey): Promise<McpRuntimeStateSnapshot> {
		let task = this.#onlineTasks.get(generationKey);
		if (task === undefined) {
			task = Promise.resolve().then(() => this.#reconcileOnline(generationKey));
			this.#onlineTasks.set(generationKey, task);
			void task.then(
				() => {
					if (this.#onlineTasks.get(generationKey) === task) {
						this.#onlineTasks.delete(generationKey);
					}
				},
				() => {
					if (this.#onlineTasks.get(generationKey) === task) {
						this.#onlineTasks.delete(generationKey);
					}
				},
			);
		}
		return task;
	}

	setOffline(generationKey: GenerationKey): Promise<McpRuntimeStateSnapshot> {
		this.#assertOpen();
		let task = this.#offlineTasks.get(generationKey);
		if (task !== undefined) return task;
		task = Promise.resolve().then(() => this.#performSetOffline(generationKey));
		this.#offlineTasks.set(generationKey, task);
		void task.then(
			() => this.#deleteOfflineTask(generationKey, task),
			() => this.#deleteOfflineTask(generationKey, task),
		);
		return task;
	}

	async #performSetOffline(generationKey: GenerationKey): Promise<McpRuntimeStateSnapshot> {
		if (this.#states.read(generationKey).phase === "quarantined") {
			throw runtimeQuarantinedError();
		}
		this.#states.transition(generationKey, "draining");
		const drain = this.#leases.invalidate(generationKey);
		const keeper = this.#keepers.get(generationKey);
		this.#keepers.delete(generationKey);
		const onlineTask = this.#onlineTasks.get(generationKey);
		const cleanupTasks = [drain, ...(keeper === undefined ? [] : [keeper.release()])];
		const [cleanupSettled] = await Promise.all([
			Promise.allSettled(cleanupTasks),
			Promise.allSettled(onlineTask === undefined ? [] : [onlineTask]),
		]);
		const cleanupFailed = cleanupSettled.some(
			(result) => result.status === "rejected" && !isRetirementError(result.reason),
		);
		if (this.#onlineTasks.get(generationKey) === onlineTask) {
			this.#onlineTasks.delete(generationKey);
		}
		if (cleanupFailed) {
			return this.#states.transition(generationKey, "quarantined", MCP_RUNTIME_CLEANUP_FAILED);
		}
		return this.#states.transition(generationKey, "offline");
	}

	#deleteOfflineTask(generationKey: GenerationKey, task: Promise<McpRuntimeStateSnapshot>): void {
		if (this.#offlineTasks.get(generationKey) === task) {
			this.#offlineTasks.delete(generationKey);
		}
	}

	#deletePostOfflineOnlineTask(
		generationKey: GenerationKey,
		task: Promise<McpRuntimeStateSnapshot>,
	): void {
		if (this.#postOfflineOnlineTasks.get(generationKey) === task) {
			this.#postOfflineOnlineTasks.delete(generationKey);
		}
	}

	async retire(generationKey: GenerationKey): Promise<void> {
		const state = await this.setOffline(generationKey);
		if (state.phase === "quarantined") {
			throw runtimeQuarantinedError();
		}
		this.#states.forget(generationKey);
	}

	async probe(
		generationKey: GenerationKey,
		signal?: AbortSignal,
	): Promise<McpRuntimeProbeSnapshot> {
		const observation = await this.#withRuntime(
			generationKey,
			async (owned, operationSignal) => {
				await this.#probeProtocolLiveness(owned, operationSignal);
				const { runtime, serverName } = owned;
				const connected = this.#states.connected(generationKey, runtime.snapshot(serverName));
				return Object.freeze({
					reachable: true as const,
					observedAt: isoTimestamp(this.#now),
					...(connected.protocolVersion === undefined
						? {}
						: { protocolVersion: connected.protocolVersion }),
					...(connected.protocolEra === undefined ? {} : { protocolEra: connected.protocolEra }),
					...(connected.capabilities === undefined ? {} : { capabilities: connected.capabilities }),
				});
			},
			signal,
		);
		return Object.freeze({
			...observation,
			runtime: this.#states.read(generationKey),
		});
	}

	refreshCatalog(
		generationKey: GenerationKey,
		signal?: AbortSignal,
	): Promise<McpRuntimeCatalogSnapshot> {
		return this.#withRuntime(
			generationKey,
			async (owned, operationSignal) => {
				await this.#probeProtocolLiveness(owned, operationSignal);
				const { runtime, serverName } = owned;
				const capabilities = runtime.snapshot(serverName).serverCapabilities;
				const [tools, resources, resourceTemplates, prompts] = await Promise.all([
					capabilities?.tools === undefined
						? Promise.resolve([])
						: runtime
								.listTools(serverName, undefined, {
									cacheMode: "refresh",
									signal: operationSignal,
								})
								.then((result) => result.tools),
					capabilities?.resources === undefined
						? Promise.resolve([])
						: runtime
								.listResources(serverName, undefined, {
									cacheMode: "refresh",
									signal: operationSignal,
								})
								.then((result) => result.resources),
					capabilities?.resources === undefined
						? Promise.resolve([])
						: runtime
								.listResourceTemplates(serverName, undefined, {
									cacheMode: "refresh",
									signal: operationSignal,
								})
								.then((result) => result.resourceTemplates)
								.catch((error: unknown) => {
									if (isMethodNotFoundProtocolError(error)) return [];
									throw error;
								}),
					capabilities?.prompts === undefined
						? Promise.resolve([])
						: runtime
								.listPrompts(serverName, undefined, {
									cacheMode: "refresh",
									signal: operationSignal,
								})
								.then((result) => result.prompts),
				]);
				const itemCount =
					tools.length + resources.length + resourceTemplates.length + prompts.length;
				if (itemCount > this.#maxDiscoveryItems) {
					throw new McpRuntimeManagerError(
						MCP_RUNTIME_DISCOVERY_LIMIT_EXCEEDED,
						"The upstream MCP catalog exceeds the configured discovery limit.",
					);
				}
				this.#states.connected(generationKey, runtime.snapshot(serverName));
				return Object.freeze({
					discoveredAt: isoTimestamp(this.#now),
					tools: Object.freeze([...tools]),
					resources: Object.freeze([...resources]),
					resourceTemplates: Object.freeze([...resourceTemplates]),
					prompts: Object.freeze([...prompts]),
				});
			},
			signal,
		);
	}

	withClientRuntime<Result>(
		generationKey: GenerationKey,
		operation: McpManagedClientRuntimeOperation<Result>,
		signal?: AbortSignal,
	): Promise<Result> {
		if (typeof operation !== "function") {
			return Promise.reject(new TypeError("operation must be a function."));
		}
		return this.#withRuntime(
			generationKey,
			(owned, operationSignal) =>
				operation(
					Object.freeze({
						runtime: owned.runtime,
						serverName: owned.serverName,
						signal: operationSignal,
					}),
				),
			signal,
			true,
		);
	}

	callTool(
		generationKey: GenerationKey,
		name: string,
		arguments_: Readonly<Record<string, unknown>>,
		options?: AbortSignal | McpRuntimeToolCallOptions,
	): Promise<CallToolResult> {
		let controls: McpRuntimeToolCallOptions;
		try {
			controls = normalizeToolCallOptions(options);
		} catch (error) {
			return Promise.reject(error);
		}
		const { signal, toolDefinition } = controls;
		return this.#withRuntime(
			generationKey,
			({ runtime, serverName }, operationSignal) =>
				runtime.callTool(
					serverName,
					{ name, arguments: { ...arguments_ } },
					{
						signal: operationSignal,
						...(toolDefinition === undefined ? {} : { toolDefinition }),
					},
				),
			signal,
			true,
		);
	}

	readResource(
		generationKey: GenerationKey,
		uri: string,
		signal?: AbortSignal,
	): Promise<ReadResourceResult> {
		return this.#withRuntime(
			generationKey,
			({ runtime, serverName }, operationSignal) =>
				runtime.readResource(serverName, { uri }, { signal: operationSignal }),
			signal,
			true,
		);
	}

	getPrompt(
		generationKey: GenerationKey,
		name: string,
		arguments_: Readonly<Record<string, string>> | undefined,
		signal?: AbortSignal,
	): Promise<GetPromptResult> {
		return this.#withRuntime(
			generationKey,
			({ runtime, serverName }, operationSignal) =>
				runtime.getPrompt(
					serverName,
					{
						name,
						...(arguments_ === undefined ? {} : { arguments: { ...arguments_ } }),
					},
					{ signal: operationSignal },
				),
			signal,
			true,
		);
	}

	state(generationKey: GenerationKey): McpRuntimeStateSnapshot {
		const keeper = this.#keepers.get(generationKey);
		if (keeper === undefined) return this.#states.read(generationKey);
		const owned = keeper.resource;
		if (owned.quarantined) return this.#states.read(generationKey);
		try {
			const snapshot = owned.runtime.snapshot(owned.serverName);
			if (snapshot.state === "connected") {
				return this.#states.connected(generationKey, snapshot);
			}
		} catch {
			// A retained keeper with no readable server snapshot is no longer healthy.
		}
		const current = this.#states.read(generationKey);
		return current.phase === "online"
			? this.#states.transition(generationKey, "degraded", MCP_RUNTIME_CONNECTION_LOST)
			: current;
	}

	snapshot(): McpRuntimeManagerSnapshot {
		const snapshot = this.#leases.snapshot();
		return Object.freeze({
			closed: snapshot.closed,
			maxConnections: snapshot.maxResources,
			connectionCount: snapshot.resourceCount,
			pendingConnectionCount: snapshot.pendingResourceCount,
			activeConnectionCount: snapshot.activeResourceCount,
			closingConnectionCount: snapshot.closingResourceCount,
			quarantinedConnectionCount: snapshot.failedResourceCount,
			operationReferenceCount: snapshot.referenceCount,
			onlineKeeperCount: this.#keepers.size,
		});
	}

	subscribe(listener: McpRuntimeStateListener): () => void {
		return this.#states.subscribe(listener);
	}

	close(): Promise<void> {
		if (this.#closeTask !== undefined) return this.#closeTask;
		this.#closed = true;
		this.#closeTask = this.#performClose();
		return this.#closeTask;
	}

	async [Symbol.asyncDispose](): Promise<void> {
		await this.close();
	}

	async #performClose(): Promise<void> {
		const close = this.#leases.close();
		const keepers = [...this.#keepers.values()];
		this.#keepers.clear();
		const settled = await Promise.allSettled([close, ...keepers.map((keeper) => keeper.release())]);
		const failures = settled.flatMap((result) =>
			result.status === "rejected" ? [result.reason as unknown] : [],
		);
		if (failures.length > 0) {
			throw new AggregateError(failures, "The MCP runtime manager failed to close.");
		}
	}

	async #reconcileOnline(generationKey: GenerationKey): Promise<McpRuntimeStateSnapshot> {
		const keeper = this.#keepers.get(generationKey);
		if (keeper === undefined) return this.#bringOnline(generationKey);
		const owned = requireActiveRuntime(keeper.resource);
		let snapshot: McpClientConnectionSnapshot;
		try {
			snapshot = owned.runtime.snapshot(owned.serverName);
		} catch (error) {
			const mapped = mapMcpRuntimeManagerError(error);
			this.#states.transition(generationKey, "degraded", runtimeManagerErrorCode(mapped));
			throw mapped;
		}
		if (snapshot.state === "connected") {
			return this.#states.connected(generationKey, snapshot);
		}
		this.#states.transition(generationKey, "connecting");
		try {
			await owned.runtime.connect(owned.serverName, {
				signal: AbortSignal.any([
					owned.generationSignal,
					AbortSignal.timeout(this.#requestTimeoutMs),
				]),
			});
			return this.#states.connected(generationKey, owned.runtime.snapshot(owned.serverName));
		} catch (error) {
			const mapped = mapMcpRuntimeManagerError(error);
			if (this.#states.read(generationKey).phase !== "quarantined") {
				this.#states.transition(generationKey, "degraded", runtimeManagerErrorCode(mapped));
			}
			throw mapped;
		}
	}

	async #bringOnline(generationKey: GenerationKey): Promise<McpRuntimeStateSnapshot> {
		this.#assertNotQuarantined(generationKey);
		this.#states.transition(generationKey, "queued");
		try {
			const lease = await this.#leases.acquire(generationKey, { releaseMode: "close" });
			if (lease.resource.quarantined) {
				await releaseIgnoringFailure(lease);
				throw runtimeQuarantinedError();
			}
			if (this.#closed) {
				await lease.release();
				throw runtimeManagerClosedError();
			}
			this.#keepers.set(generationKey, lease);
			return this.#states.read(generationKey);
		} catch (error) {
			const mapped = mapMcpRuntimeManagerError(error);
			if (this.#states.read(generationKey).phase !== "quarantined") {
				this.#states.transition(generationKey, "failed", runtimeManagerErrorCode(mapped));
			}
			throw mapped;
		}
	}

	async #withRuntime<Result>(
		generationKey: GenerationKey,
		operation: (owned: ActiveMcpRuntime<GenerationKey>, signal: AbortSignal) => Promise<Result>,
		callerSignal?: AbortSignal,
		requireOnline = false,
	): Promise<Result> {
		this.#assertOpen();
		if (this.#offlineTasks.has(generationKey)) throw runtimeNotReadyError();
		if (requireOnline) this.#assertOnlineKeeper(generationKey);
		const acquisitionSignal = AbortSignal.any([
			AbortSignal.timeout(this.#requestTimeoutMs),
			...(callerSignal === undefined ? [] : [callerSignal]),
		]);
		let lease: McpClientLease<OwnedMcpRuntime<GenerationKey>>;
		try {
			lease = await this.#leases.acquire(generationKey, {
				releaseMode: "close",
				signal: acquisitionSignal,
			});
		} catch (error) {
			throwIfCallerAborted(callerSignal);
			throw mapMcpRuntimeManagerError(error);
		}
		const owned = lease.resource;
		if (owned.quarantined) {
			await releaseIgnoringFailure(lease);
			throw runtimeQuarantinedError();
		}
		const operationSignal = AbortSignal.any([acquisitionSignal, owned.generationSignal]);
		let outcome:
			| { readonly success: true; readonly value: Result }
			| { readonly success: false; readonly error: unknown };
		try {
			outcome = { success: true, value: await operation(owned, operationSignal) };
		} catch (error) {
			outcome = { success: false, error };
		}
		try {
			await lease.release();
		} catch (error) {
			this.#states.transition(generationKey, "quarantined", MCP_RUNTIME_CLEANUP_FAILED);
			throw runtimeQuarantinedError(error);
		}
		if (!outcome.success) {
			throwIfCallerAborted(callerSignal);
			throw mapMcpRuntimeManagerError(outcome.error);
		}
		return outcome.value;
	}

	async #probeProtocolLiveness(
		owned: ActiveMcpRuntime<GenerationKey>,
		signal: AbortSignal,
	): Promise<void> {
		const { runtime, serverName } = owned;
		const protocolEra = runtime.snapshot(serverName).protocolEra;
		if (protocolEra === "legacy") {
			await runtime.ping(serverName, { signal });
			return;
		}
		if (protocolEra === "modern") {
			await runtime.discover(serverName, { signal });
			return;
		}
		throw new McpRuntimeManagerError(
			"MCP_UPSTREAM_FAILED",
			"The connected MCP server did not report a protocol era.",
		);
	}

	#assertOpen(): void {
		if (this.#closed) throw runtimeManagerClosedError();
	}

	#assertNotQuarantined(generationKey: GenerationKey): void {
		if (this.#states.read(generationKey).phase === "quarantined") {
			throw runtimeQuarantinedError();
		}
	}

	#assertOnlineKeeper(generationKey: GenerationKey): void {
		const keeper = this.#keepers.get(generationKey);
		if (keeper === undefined) throw runtimeNotReadyError();
		const owned = requireActiveRuntime(keeper.resource);
		const snapshot = owned.runtime.snapshot(owned.serverName);
		if (snapshot.state !== "connected") {
			this.#states.transition(generationKey, "degraded", MCP_RUNTIME_CONNECTION_LOST);
			throw runtimeNotReadyError();
		}
		this.#states.connected(generationKey, snapshot);
	}
}

const EMPTY_TOOL_CALL_OPTIONS: McpRuntimeToolCallOptions = Object.freeze({});

/** Accepts the positional cancellation form and the richer per-call options object. */
function normalizeToolCallOptions(
	options: AbortSignal | McpRuntimeToolCallOptions | undefined,
): McpRuntimeToolCallOptions {
	if (options === undefined) return EMPTY_TOOL_CALL_OPTIONS;
	if (typeof options !== "object" || options === null) {
		throw new TypeError("callTool options must be an AbortSignal or a tool call options object.");
	}
	return isAbortSignal(options) ? { signal: options } : options;
}

function isAbortSignal(value: object): value is AbortSignal {
	if (value instanceof AbortSignal) return true;
	try {
		return (
			typeof Reflect.get(value, "aborted") === "boolean" &&
			typeof Reflect.get(value, "addEventListener") === "function"
		);
	} catch {
		return false;
	}
}

function isMethodNotFoundProtocolError(error: unknown): error is ProtocolError {
	return ProtocolError.isInstance(error) && error.code === METHOD_NOT_FOUND;
}

function requireActiveRuntime<GenerationKey>(
	owned: OwnedMcpRuntime<GenerationKey>,
): ActiveMcpRuntime<GenerationKey> {
	if (owned.quarantined) throw runtimeQuarantinedError();
	return owned;
}

function throwIfCallerAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted === true) throw signal.reason;
}

function isRetirementError(error: unknown): boolean {
	if (typeof error !== "object" || error === null) return false;
	try {
		const code = Reflect.get(error, "code");
		return code === MCP_CLIENT_LEASE_INVALIDATED || code === MCP_RUNTIME_GENERATION_RETIRED;
	} catch {
		return false;
	}
}

async function releaseIgnoringFailure<Resource extends object>(
	lease: McpClientLease<Resource>,
): Promise<void> {
	try {
		await lease.release();
	} catch {
		// The public disposition remains quarantined; the lease manager retains the failed generation.
	}
}

function waitForCaller<Result>(task: Promise<Result>, signal?: AbortSignal): Promise<Result> {
	if (signal === undefined) return task;
	if (signal.aborted) return Promise.reject(signal.reason);
	return new Promise<Result>((resolve, reject) => {
		const onAbort = (): void => {
			signal.removeEventListener("abort", onAbort);
			reject(signal.reason);
		};
		signal.addEventListener("abort", onAbort, { once: true });
		void task.then(
			(result) => {
				signal.removeEventListener("abort", onAbort);
				resolve(result);
			},
			(error: unknown) => {
				signal.removeEventListener("abort", onAbort);
				reject(error);
			},
		);
	});
}

function positiveInteger(value: number, name: string): number {
	if (!Number.isInteger(value) || value <= 0) {
		throw new RangeError(`${name} must be a positive integer.`);
	}
	return value;
}

function positiveFinite(value: number, name: string): number {
	if (!Number.isFinite(value) || value <= 0) {
		throw new RangeError(`${name} must be a positive finite number.`);
	}
	return value;
}

function isoTimestamp(now: () => number): string {
	try {
		const timestamp = now();
		if (Number.isFinite(timestamp)) return new Date(timestamp).toISOString();
	} catch {
		// Fall through to the system clock if an injected diagnostics clock fails.
	}
	return new Date().toISOString();
}

function safeClock(now: () => number): () => number {
	return () => {
		try {
			const timestamp = now();
			if (Number.isFinite(timestamp)) {
				new Date(timestamp).toISOString();
				return timestamp;
			}
		} catch {
			// Diagnostics clocks are best-effort; lifecycle ownership must remain available.
		}
		return Date.now();
	};
}
