import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";

import { ApiExceptionFilter } from "./common/api-exception.filter.ts";
import { ConnectionControlModule } from "./connections/connection-control.module.ts";
import { ControlPlaneConfigModule } from "./config/control-plane-config.module.ts";
import { HealthModule } from "./health/health.module.ts";
import { OAuthControlModule } from "./oauth/oauth-control.module.ts";

@Module({
	imports: [ControlPlaneConfigModule, ConnectionControlModule, OAuthControlModule, HealthModule],
	providers: [{ provide: APP_FILTER, useClass: ApiExceptionFilter }],
})
export class AppModule {}
