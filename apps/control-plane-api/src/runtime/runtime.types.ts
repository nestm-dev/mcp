import type { FetchLike } from "@modelcontextprotocol/client";

export type {
	McpRuntimeCatalogSnapshot as RuntimeCatalogView,
	McpRuntimeManagerPort as RuntimeSupervisorPort,
	McpRuntimeManagerSnapshot as RuntimeManagerView,
	McpRuntimePhase as RuntimePhase,
	McpRuntimeProbeSnapshot as RuntimeProbeView,
	McpRuntimeStateSnapshot as RuntimeStateView,
} from "@nestm/mcp-manager";

export const MCP_CONTROL_PLANE_BASE_FETCH = Symbol("example-mcp-control-plane:base-fetch");
export const MCP_RUNTIME_SUPERVISOR = Symbol("example-mcp-control-plane:runtime-supervisor");

export type McpBaseFetch = FetchLike;
