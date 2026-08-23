import { BadRequestException, Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { StandardSchemaModule } from "@nestm/standard-schema";

import { ApiExceptionFilter } from "./common/api-exception.filter.ts";
import { ConnectionControlModule } from "./connections/connection-control.module.ts";
import { ConformanceModule } from "./conformance/conformance.module.ts";
import { ControlPlaneConfigModule } from "./config/control-plane-config.module.ts";
import { HealthModule } from "./health/health.module.ts";
import { OAuthControlModule } from "./oauth/oauth-control.module.ts";

@Module({
	imports: [
		StandardSchemaModule.forRoot({
			serialization: false,
			validation: {
				exceptionFactory: (issues) =>
					new BadRequestException(
						issues.map((issue) => {
							const path = issue.path
								?.map((segment) => String(typeof segment === "object" ? segment.key : segment))
								.join(".");
							return path === undefined || path.length === 0
								? issue.message
								: `${path}: ${issue.message}`;
						}),
					),
			},
		}),
		ControlPlaneConfigModule,
		ConnectionControlModule,
		ConformanceModule,
		OAuthControlModule,
		HealthModule,
	],
	providers: [{ provide: APP_FILTER, useClass: ApiExceptionFilter }],
})
export class AppModule {}
