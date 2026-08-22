import { Transform } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
	IsIn,
	IsInt,
	IsObject,
	IsOptional,
	IsString,
	IsUrl,
	Length,
	Max,
	Min,
	ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

import type { ConnectionAuthenticationKind, DesiredConnectionState } from "./connection.types.ts";

export class ConnectionAuthenticationDto {
	@ApiProperty({ enum: ["none", "oauth"] })
	@IsIn(["none", "oauth"] satisfies readonly ConnectionAuthenticationKind[])
	kind!: ConnectionAuthenticationKind;
}

export class CreateConnectionDto {
	@ApiProperty({ maxLength: 120 })
	@IsString()
	@Length(1, 120)
	@Transform(({ value }): unknown => (typeof value === "string" ? value.trim() : value))
	displayName!: string;

	@ApiProperty({ format: "uri", example: "http://127.0.0.1:3200/mcp" })
	@IsUrl({ require_protocol: true, require_tld: false, protocols: ["http", "https"] })
	endpoint!: string;

	@ApiPropertyOptional({ default: "offline", enum: ["offline", "online"] })
	@IsOptional()
	@IsIn(["offline", "online"] satisfies readonly DesiredConnectionState[])
	desiredState?: DesiredConnectionState;

	@ApiPropertyOptional({
		oneOf: [
			{ type: "object", required: ["kind"], properties: { kind: { enum: ["none"] } } },
			{ type: "object", required: ["kind"], properties: { kind: { enum: ["oauth"] } } },
		],
		default: { kind: "none" },
	})
	@IsOptional()
	@ValidateNested()
	@Type(() => ConnectionAuthenticationDto)
	authentication?: ConnectionAuthenticationDto;
}

export class ReplaceConnectionDto {
	@ApiProperty({ minimum: 1 })
	@IsInt()
	@Min(1)
	@Max(Number.MAX_SAFE_INTEGER)
	expectedRevision!: number;

	@ApiProperty({ maxLength: 120 })
	@IsString()
	@Length(1, 120)
	@Transform(({ value }): unknown => (typeof value === "string" ? value.trim() : value))
	displayName!: string;

	@ApiPropertyOptional({
		description: "Omit to preserve the currently admitted endpoint and runtime generation.",
		format: "uri",
		example: "http://127.0.0.1:3200/mcp",
	})
	@IsOptional()
	@IsUrl({ require_protocol: true, require_tld: false, protocols: ["http", "https"] })
	endpoint?: string;
}

export class SetDesiredStateDto {
	@ApiProperty({ minimum: 1 })
	@IsInt()
	@Min(1)
	@Max(Number.MAX_SAFE_INTEGER)
	expectedRevision!: number;

	@ApiProperty({ enum: ["offline", "online"] })
	@IsIn(["offline", "online"] satisfies readonly DesiredConnectionState[])
	state!: DesiredConnectionState;
}

export class CallToolDto {
	@ApiProperty({ maxLength: 200 })
	@IsString()
	@Length(1, 200)
	name!: string;

	@ApiPropertyOptional({ type: "object", additionalProperties: true })
	@IsOptional()
	@IsObject()
	arguments?: Record<string, unknown>;
}

export class ReadResourceDto {
	@ApiProperty({ maxLength: 4_096 })
	@IsString()
	@Length(1, 4_096)
	uri!: string;
}

export class GetPromptDto {
	@ApiProperty({ maxLength: 200 })
	@IsString()
	@Length(1, 200)
	name!: string;

	@ApiPropertyOptional({ type: "object", additionalProperties: { type: "string" } })
	@IsOptional()
	@IsObject()
	arguments?: Record<string, string>;
}
