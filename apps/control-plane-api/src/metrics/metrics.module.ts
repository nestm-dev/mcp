import { Module } from "@nestjs/common";
import type { McpMetricsSink } from "@nestm/mcp-observability";
import { createMcpMetricsObserver } from "@nestm/mcp-observability";

import { InMemoryMcpMetricsService } from "./in-memory-mcp-metrics.service.ts";
import { McpMetricsController, PrometheusMetricsController } from "./metrics.controller.ts";
import { MCP_CONTROL_PLANE_METRICS_OBSERVER } from "./metrics.tokens.ts";

@Module({
	controllers: [McpMetricsController, PrometheusMetricsController],
	providers: [
		{
			provide: InMemoryMcpMetricsService,
			useFactory: () => new InMemoryMcpMetricsService(),
		},
		{
			provide: MCP_CONTROL_PLANE_METRICS_OBSERVER,
			inject: [InMemoryMcpMetricsService],
			useFactory: (sink: McpMetricsSink) =>
				createMcpMetricsObserver(sink, {
					projection: {
						includeTarget: false,
						maxAttributes: 8,
						maxStringLength: 128,
					},
				}),
		},
	],
	exports: [MCP_CONTROL_PLANE_METRICS_OBSERVER],
})
export class McpMetricsModule {}
