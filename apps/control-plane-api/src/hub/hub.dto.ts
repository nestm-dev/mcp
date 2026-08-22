import { Transform, Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsInt, IsOptional, IsString, Matches, Max, Min } from "class-validator";

export const HUB_NAMESPACE_PATTERN = /^[a-z](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

export class AttachHubMemberDto {
	@ApiProperty({
		example: "deepwiki",
		maxLength: 32,
		pattern: HUB_NAMESPACE_PATTERN.source,
	})
	@IsString()
	@Matches(HUB_NAMESPACE_PATTERN)
	@Transform(({ value }): unknown => (typeof value === "string" ? value.trim() : value))
	namespace!: string;

	@ApiProperty({ minimum: 1 })
	@IsInt()
	@Min(1)
	@Max(Number.MAX_SAFE_INTEGER)
	expectedHubRevision!: number;

	@ApiProperty({ minimum: 1 })
	@IsInt()
	@Min(1)
	@Max(Number.MAX_SAFE_INTEGER)
	expectedConnectionRevision!: number;

	@ApiProperty({ minimum: 1 })
	@IsInt()
	@Min(1)
	@Max(Number.MAX_SAFE_INTEGER)
	runtimeGeneration!: number;
}

export class DetachHubMemberQueryDto {
	@ApiProperty({ minimum: 1 })
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(Number.MAX_SAFE_INTEGER)
	expectedHubRevision!: number;

	@ApiProperty({ minimum: 1 })
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(Number.MAX_SAFE_INTEGER)
	runtimeGeneration!: number;
}

export class HubCatalogQueryDto {
	@ApiPropertyOptional({ minimum: 1 })
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(Number.MAX_SAFE_INTEGER)
	expectedHubRevision?: number;
}

export class RefreshHubCatalogDto {
	@ApiProperty({ minimum: 1 })
	@IsInt()
	@Min(1)
	@Max(Number.MAX_SAFE_INTEGER)
	expectedHubRevision!: number;
}
