import { mutationOptions, queryOptions } from "@tanstack/react-query";

import {
  controlPlaneApi,
  type Connection,
  type Hub,
  type HubMember,
  type RuntimeManager,
  type RuntimePhase,
  type ToolCallInput,
  type ToolCallResult,
} from "./control-plane-api";

export const controlPlaneKeys = {
  all: ["control-plane"] as const,
  connections: ["control-plane", "connections"] as const,
  runtime: ["control-plane", "runtime"] as const,
  metrics: ["control-plane", "metrics"] as const,
  hub: ["control-plane", "hub"] as const,
  hubRefresh: ["control-plane", "hub", "refresh"] as const,
  toolCall: (connectionId: string) => ["control-plane", "tool-call", connectionId] as const,
  catalog: (connectionId: string, runtimeGeneration: number) =>
    ["control-plane", "catalog", connectionId, runtimeGeneration] as const,
  catalogPrefix: (connectionId: string) => ["control-plane", "catalog", connectionId] as const,
};

const transientPhases: ReadonlySet<RuntimePhase> = new Set([
  "queued",
  "connecting",
  "degraded",
  "draining",
]);

export const TRANSIENT_POLL_INTERVAL_MS = 1_250;
export const METRICS_POLL_INTERVAL_MS = 5_000;

export function isTransientPhase(phase: RuntimePhase): boolean {
  return transientPhases.has(phase);
}

export function connectionPollInterval(
  connections: readonly Connection[] | undefined,
): number | false {
  return connections?.some((connection) => isTransientPhase(connection.runtime.phase)) === true
    ? TRANSIENT_POLL_INTERVAL_MS
    : false;
}

export function runtimePollInterval(runtime: RuntimeManager | undefined): number | false {
  return runtime !== undefined &&
    (runtime.pendingConnectionCount > 0 || runtime.closingConnectionCount > 0)
    ? TRANSIENT_POLL_INTERVAL_MS
    : false;
}

export function metricsQueryOptions() {
  return queryOptions({
    queryKey: controlPlaneKeys.metrics,
    queryFn: ({ signal }) => controlPlaneApi.metricsSnapshot(signal),
    refetchInterval: METRICS_POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });
}

export function hubQueryOptions() {
  return queryOptions({
    queryKey: controlPlaneKeys.hub,
    queryFn: ({ signal }) => controlPlaneApi.hubSnapshot(signal),
  });
}

export interface AttachHubMemberInput {
  readonly connection: Connection;
  readonly hubRevision: number;
  readonly namespace: string;
}

export function attachHubMemberMutationOptions() {
  return mutationOptions<Hub, Error, AttachHubMemberInput>({
    mutationKey: ["control-plane", "hub", "member"] as const,
    mutationFn: ({ connection, hubRevision, namespace }) =>
      controlPlaneApi.attachHubMember({
        connectionId: connection.id,
        expectedConnectionRevision: connection.revision,
        expectedHubRevision: hubRevision,
        namespace,
        runtimeGeneration: connection.runtimeGeneration,
      }),
    retry: false,
  });
}

export interface DetachHubMemberInput {
  readonly hubRevision: number;
  readonly member: HubMember;
}

export function detachHubMemberMutationOptions() {
  return mutationOptions<void, Error, DetachHubMemberInput>({
    mutationKey: ["control-plane", "hub", "member"] as const,
    mutationFn: ({ hubRevision, member }) =>
      controlPlaneApi.detachHubMember(member.connectionId, hubRevision, member.runtimeGeneration),
    retry: false,
  });
}

export function refreshHubCatalogMutationOptions() {
  return mutationOptions<Hub, Error, number>({
    mutationKey: controlPlaneKeys.hubRefresh,
    mutationFn: (hubRevision) => controlPlaneApi.refreshHubCatalog(hubRevision),
    retry: false,
  });
}

export function toolCallMutationOptions(connectionId: string) {
  return mutationOptions<ToolCallResult, Error, ToolCallInput>({
    mutationKey: controlPlaneKeys.toolCall(connectionId),
    mutationFn: (input) => controlPlaneApi.callTool(connectionId, input),
    // A tool may have external side effects, so transport failures must never trigger a replay.
    retry: false,
  });
}
