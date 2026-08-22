import { Controller, Get, Header, Inject } from "@nestjs/common";
import { ApiOkResponse, ApiProduces, ApiTags } from "@nestjs/swagger";

import { InMemoryMcpMetricsService } from "./in-memory-mcp-metrics.service.ts";
import { McpMetricsSnapshotResponseDto } from "./metrics.response.ts";
import type { McpMetricsSnapshotView } from "./metrics.types.ts";

export const PROMETHEUS_CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8";

@ApiTags("MCP metrics")
@Controller("v1/mcp/metrics")
export class McpMetricsController {
	constructor(
		@Inject(InMemoryMcpMetricsService)
		private readonly metrics: InMemoryMcpMetricsService,
	) {}

	@Get()
	@Header("Cache-Control", "no-store")
	@ApiOkResponse({ type: McpMetricsSnapshotResponseDto })
	snapshot(): McpMetricsSnapshotView {
		return this.metrics.snapshot();
	}
}

@ApiTags("MCP metrics")
@Controller("metrics")
export class PrometheusMetricsController {
	constructor(
		@Inject(InMemoryMcpMetricsService)
		private readonly metrics: InMemoryMcpMetricsService,
	) {}

	@Get()
	@Header("Cache-Control", "no-store")
	@Header("Content-Type", PROMETHEUS_CONTENT_TYPE)
	@ApiProduces(PROMETHEUS_CONTENT_TYPE)
	@ApiOkResponse({ schema: { type: "string" } })
	snapshot(): string {
		return this.metrics.prometheus();
	}
}
