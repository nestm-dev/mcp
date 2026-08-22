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
	ValidateBy,
	ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

import type { ConnectionAuthenticationKind, DesiredConnectionState } from "./connection.types.ts";

const MAX_PROMPT_ARGUMENTS = 64;
const MAX_PROMPT_ARGUMENT_NAME_CHARACTERS = 200;
const MAX_PROMPT_ARGUMENT_VALUE_CHARACTERS = 16 * 1_024;
const MAX_PROMPT_ARGUMENT_JSON_BYTES = 64 * 1_024;

function IsPromptArguments(): PropertyDecorator {
	return ValidateBy({
		name: "isPromptArguments",
		validator: {
			validate(value: unknown): boolean {
				if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
				const entries = Object.entries(value);
				if (entries.length > MAX_PROMPT_ARGUMENTS) return false;
				if (
					entries.some(
						([name, argument]) =>
							name.length === 0 ||
							name.length > MAX_PROMPT_ARGUMENT_NAME_CHARACTERS ||
							typeof argument !== "string" ||
							argument.length > MAX_PROMPT_ARGUMENT_VALUE_CHARACTERS,
					)
				) {
					return false;
				}
				try {
					return (
						new TextEncoder().encode(JSON.stringify(value)).byteLength <=
						MAX_PROMPT_ARGUMENT_JSON_BYTES
					);
				} catch {
					return false;
				}
			},
			defaultMessage(): string {
				return "arguments must contain at most 64 string values and fit within 64 KiB";
			},
		},
	});
}

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
	@IsPromptArguments()
	arguments?: Record<string, string>;
}
