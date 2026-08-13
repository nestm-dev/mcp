import { ConfigurableModuleBuilder } from "@nestjs/common";
import { MCP_MODULE_OPTIONS } from "./mcp.tokens.ts";
import type { McpModuleExtras, McpModuleOptions } from "./mcp.types.ts";

export const { ConfigurableModuleClass, OPTIONS_TYPE, ASYNC_OPTIONS_TYPE } =
	new ConfigurableModuleBuilder<McpModuleOptions>({
		optionsInjectionToken: MCP_MODULE_OPTIONS,
	})
		.setClassMethodName("forRoot")
		.setFactoryMethodName("createMcpOptions")
		.setExtras<McpModuleExtras>({ isGlobal: true }, (definition, extras) => ({
			...definition,
			global: extras.isGlobal !== false,
		}))
		.build();

export type McpForRootOptions = typeof OPTIONS_TYPE;
export type McpForRootAsyncOptions = typeof ASYNC_OPTIONS_TYPE;
