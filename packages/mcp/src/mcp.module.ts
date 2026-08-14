import { Module } from "@nestjs/common";
import type { DynamicModule } from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";
import { McpClientRuntime } from "@nestm/mcp-client";
import { McpServerRegistry } from "@nestm/mcp-server";
import {
	ConfigurableModuleClass,
	type McpForRootAsyncOptions,
	type McpForRootOptions,
} from "./mcp.module-definition.ts";
import { McpCapabilitiesService } from "./mcp-capabilities.service.ts";
import { McpRuntimeService } from "./mcp-runtime.service.ts";
import { MCP_MODULE_OPTIONS } from "./mcp.tokens.ts";
import { McpHandlerExplorer } from "./discovery/mcp-handler.explorer.ts";
import { McpHandlerRegistry } from "./discovery/mcp-handler.registry.ts";

const MCP_PROVIDERS = [
	{
		provide: McpClientRuntime,
		inject: [MCP_MODULE_OPTIONS],
		useFactory: (options: McpForRootOptions) =>
			new McpClientRuntime({
				...options.clientRuntime,
				...(options.clients === undefined ? {} : { servers: options.clients }),
			}),
	},
	McpServerRegistry,
	McpHandlerRegistry,
	McpCapabilitiesService,
	McpHandlerExplorer,
	McpRuntimeService,
];

@Module({
	imports: [DiscoveryModule],
	providers: MCP_PROVIDERS,
	exports: [McpClientRuntime, McpCapabilitiesService, McpRuntimeService],
})
export class McpModule extends ConfigurableModuleClass {
	static override forRoot(options: McpForRootOptions = {}): DynamicModule {
		return super.forRoot(options);
	}

	static override forRootAsync(options: McpForRootAsyncOptions): DynamicModule {
		return super.forRootAsync(options);
	}
}
