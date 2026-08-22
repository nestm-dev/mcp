import { Module } from "@nestjs/common";
import type { FetchLike } from "@modelcontextprotocol/client";

import { ConnectionStoreModule } from "../connections/connection-store.module.ts";
import { ControlPlaneConfigModule } from "../config/control-plane-config.module.ts";
import { OAuthAuthorityModule } from "../oauth/oauth-authority.module.ts";
import { McpEndpointAdmissionService } from "./mcp-endpoint-admission.service.ts";
import { InMemoryRuntimeGenerationResolver } from "./runtime-generation.resolver.ts";
import { MCP_CONTROL_PLANE_BASE_FETCH } from "./runtime.types.ts";

const defaultFetch: FetchLike = (input, init) => globalThis.fetch(input, init);

@Module({
	imports: [ControlPlaneConfigModule, ConnectionStoreModule, OAuthAuthorityModule],
	providers: [
		{ provide: MCP_CONTROL_PLANE_BASE_FETCH, useValue: defaultFetch },
		McpEndpointAdmissionService,
		InMemoryRuntimeGenerationResolver,
	],
	exports: [McpEndpointAdmissionService, InMemoryRuntimeGenerationResolver],
})
export class RuntimeGenerationModule {}
