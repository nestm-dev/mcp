import { Module } from "@nestjs/common";
import type { FetchLike } from "@modelcontextprotocol/client";

import { ControlPlaneConfigModule } from "../config/control-plane-config.module.ts";
import { OAuthNetworkPolicyService } from "./oauth-network-policy.service.ts";
import { MCP_OAUTH_BASE_FETCH } from "./oauth.types.ts";
import { VolatileOAuthAuthorityService } from "./volatile-oauth-authority.service.ts";

const defaultOAuthFetch: FetchLike = (input, init) => globalThis.fetch(input, init);

@Module({
	imports: [ControlPlaneConfigModule],
	providers: [
		{ provide: MCP_OAUTH_BASE_FETCH, useValue: defaultOAuthFetch },
		OAuthNetworkPolicyService,
		VolatileOAuthAuthorityService,
	],
	exports: [OAuthNetworkPolicyService, VolatileOAuthAuthorityService],
})
export class OAuthAuthorityModule {}
