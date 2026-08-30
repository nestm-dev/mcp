import type { Prompt, Resource, ResourceTemplateType, Tool } from "@modelcontextprotocol/client";
import type {
	CallToolResult,
	GetPromptResult,
	McpClientConnectionSnapshot,
	McpClientRuntime,
	McpClientRuntimeOptions,
	McpClientTransportDefinition,
	ReadResourceResult,
} from "@nestm/mcp-client";
import type { McpLifecycleObserver, MaybePromise } from "@nestm/mcp-core";

import type { McpRuntimeStateErrorCode } from "./errors.ts";

export type McpRuntimePhase =
	| "offline"
	| "queued"
	| "connecting"
	| "online"
	| "degraded"
	| "draining"
	| "failed"
	| "quarantined";

/** Protocol era negotiated by a connected managed runtime generation. */
export type McpRuntimeProtocolEra = NonNullable<McpClientConnectionSnapshot["protocolEra"]>;

export interface McpRuntimeCapabilitiesSnapshot {
	readonly tools: boolean;
	readonly resources: boolean;
	readonly prompts: boolean;
	readonly completion: boolean;
	readonly subscriptions: boolean;
}

/**
 * Normalized immutable projection of one managed runtime's lifecycle state.
 *
 * Optional properties are absent rather than present with an `undefined` value.
 * The snapshot and its nested capability projection are frozen.
 */
export interface McpRuntimeStateSnapshot {
	readonly phase: McpRuntimePhase;
	readonly lastTransitionAt: string;
	readonly protocolVersion?: string;
	readonly protocolEra?: McpRuntimeProtocolEra;
	readonly connectedAt?: string;
	readonly errorCode?: McpRuntimeStateErrorCode;
	readonly capabilities?: McpRuntimeCapabilitiesSnapshot;
}

/** Aggregate diagnostics deliberately omit opaque generation keys and runtime names. */
export interface McpRuntimeManagerSnapshot {
	readonly closed: boolean;
	readonly maxConnections: number;
	readonly connectionCount: number;
	readonly pendingConnectionCount: number;
	readonly activeConnectionCount: number;
	readonly closingConnectionCount: number;
	readonly quarantinedConnectionCount: number;
	readonly operationReferenceCount: number;
	readonly onlineKeeperCount: number;
}

export interface McpRuntimeCatalogSnapshot {
	readonly discoveredAt: string;
	readonly tools: readonly Tool[];
	readonly resources: readonly Resource[];
	readonly resourceTemplates: readonly ResourceTemplateType[];
	readonly prompts: readonly Prompt[];
}

export interface McpRuntimeProbeSnapshot {
	readonly reachable: true;
	readonly observedAt: string;
	readonly protocolVersion?: string;
	readonly protocolEra?: McpRuntimeProtocolEra;
	readonly capabilities?: McpRuntimeCapabilitiesSnapshot;
	readonly runtime: McpRuntimeStateSnapshot;
}

/**
 * Narrow client-runtime surface available while the manager owns a generation lease.
 * Registry mutation, transport admission, shutdown, and credential material stay private.
 */
export type McpManagedClientRuntime = Pick<
	McpClientRuntime,
	| "callTool"
	| "complete"
	| "getPrompt"
	| "listPrompts"
	| "listResources"
	| "listResourceTemplates"
	| "listTools"
	| "readResource"
	| "request"
	| "requestWithInputRequired"
	| "snapshot"
>;

export interface McpManagedClientRuntimeContext {
	readonly runtime: McpManagedClientRuntime;
	readonly serverName: string;
	readonly signal: AbortSignal;
}

export type McpManagedClientRuntimeOperation<Result> = (
	context: McpManagedClientRuntimeContext,
) => Promise<Result>;

/**
 * Host-authorized transport material for one opaque runtime generation.
 *
 * The close callback is wrapped by the manager, but hosts should still make it
 * idempotent because process-level cleanup can be retried after failures.
 */
export interface McpAdmittedRuntimeGeneration {
	readonly transport: McpClientTransportDefinition;
	close(): Promise<void>;
}

/**
 * Resolves an opaque, non-secret generation key into already-admitted runtime
 * material. Product records, credentials, endpoint policy, and tenancy remain
 * behind this interface.
 */
export interface McpRuntimeGenerationResolver<GenerationKey = string> {
	resolve(generationKey: GenerationKey, signal: AbortSignal): Promise<McpAdmittedRuntimeGeneration>;
}

/**
 * A key-free, bounded state transition suitable for metrics and diagnostics.
 * It intentionally omits endpoints, server names, generation keys, payloads,
 * error messages, and credentials.
 */
export interface McpRuntimeStateTransitionEvent {
	readonly type: "runtime.state.changed";
	readonly timestamp: number;
	readonly phase: McpRuntimePhase;
	readonly previousPhase?: McpRuntimePhase;
	readonly errorCode?: McpRuntimeStateErrorCode;
	readonly protocolEra?: McpRuntimeProtocolEra;
	readonly capabilities?: McpRuntimeCapabilitiesSnapshot;
}

export type McpRuntimeStateListener = (event: McpRuntimeStateTransitionEvent) => MaybePromise<void>;

export interface McpRuntimeManagerOptions<GenerationKey = string> {
	readonly generationResolver: McpRuntimeGenerationResolver<GenerationKey>;
	readonly maxConnections?: number;
	/** Maximum retained generation state projections; must be at least maxConnections. */
	readonly maxStateEntries?: number;
	readonly requestTimeoutMs?: number;
	readonly shutdownTimeoutMs?: number;
	readonly maxDiscoveryPages?: number;
	readonly maxDiscoveryItems?: number;
	/** Identity advertised by every short-lived managed MCP client runtime. */
	readonly clientInfo?: NonNullable<McpClientRuntimeOptions["clientInfo"]>;
	/** Receives operation lifecycle events from every managed client runtime. */
	readonly observer?: McpLifecycleObserver;
	/** Unix epoch milliseconds, injectable for deterministic state and runtime snapshots. */
	readonly now?: () => number;
	/** Listener failures never alter runtime lifecycle; this hook receives them best-effort. */
	readonly onListenerError?: (
		error: unknown,
		event: McpRuntimeStateTransitionEvent,
	) => MaybePromise<void>;
}

/**
 * Per-call controls for the manager's convenience tool invocation.
 *
 * Pinning `toolDefinition` keeps the managed client runtime's structured output
 * validation bound to that exact definition instead of a cached `tools/list`
 * view, so a host that already holds an approved definition never validates a
 * result against a drifted schema.
 */
export interface McpRuntimeToolCallOptions {
	readonly signal?: AbortSignal;
	readonly toolDefinition?: Tool;
}

export interface McpRuntimeManagerPort<GenerationKey = string> {
	ensureOnline(
		generationKey: GenerationKey,
		signal?: AbortSignal,
	): Promise<McpRuntimeStateSnapshot>;
	setOffline(generationKey: GenerationKey): Promise<McpRuntimeStateSnapshot>;
	retire(generationKey: GenerationKey): Promise<void>;
	probe(generationKey: GenerationKey, signal?: AbortSignal): Promise<McpRuntimeProbeSnapshot>;
	refreshCatalog(
		generationKey: GenerationKey,
		signal?: AbortSignal,
	): Promise<McpRuntimeCatalogSnapshot>;
	/** Execute a protocol-aware integration operation under the generation's managed lease. */
	withClientRuntime<Result>(
		generationKey: GenerationKey,
		operation: McpManagedClientRuntimeOperation<Result>,
		signal?: AbortSignal,
	): Promise<Result>;
	/** A positional `AbortSignal` stays accepted as the cancellation-only form of the options. */
	callTool(
		generationKey: GenerationKey,
		name: string,
		arguments_: Readonly<Record<string, unknown>>,
		options?: AbortSignal | McpRuntimeToolCallOptions,
	): Promise<CallToolResult>;
	readResource(
		generationKey: GenerationKey,
		uri: string,
		signal?: AbortSignal,
	): Promise<ReadResourceResult>;
	getPrompt(
		generationKey: GenerationKey,
		name: string,
		arguments_: Readonly<Record<string, string>> | undefined,
		signal?: AbortSignal,
	): Promise<GetPromptResult>;
	state(generationKey: GenerationKey): McpRuntimeStateSnapshot;
	snapshot(): McpRuntimeManagerSnapshot;
	subscribe(listener: McpRuntimeStateListener): () => void;
	close(): Promise<void>;
	[Symbol.asyncDispose](): Promise<void>;
}
