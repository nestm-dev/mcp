import {
	Body,
	Controller,
	Delete,
	Get,
	Header,
	HttpCode,
	HttpStatus,
	Inject,
	Param,
	ParseUUIDPipe,
	Post,
	Put,
	Query,
} from "@nestjs/common";
import { ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";

import {
	AttachHubMemberDto,
	DetachHubMemberQueryDto,
	HubCatalogQueryDto,
	RefreshHubCatalogDto,
} from "./hub.dto.ts";
import { HubCatalogResponseDto, HubResponseDto } from "./hub.response.ts";
import { HubService } from "./hub.service.ts";

@ApiTags("MCP hub")
@Controller("v1/mcp/hub")
export class HubController {
	constructor(@Inject(HubService) private readonly hub: HubService) {}

	@Get()
	@Header("Cache-Control", "no-store")
	@ApiOkResponse({ type: HubResponseDto })
	view() {
		return this.hub.view();
	}

	@Put("members/:connectionId")
	@ApiOperation({ summary: "Attach one live MCP generation to the process-local hub" })
	@ApiOkResponse({ type: HubResponseDto })
	attach(
		@Param("connectionId", ParseUUIDPipe) connectionId: string,
		@Body() body: AttachHubMemberDto,
	) {
		return this.hub.attach(connectionId, body);
	}

	@Delete("members/:connectionId")
	@HttpCode(HttpStatus.NO_CONTENT)
	@ApiNoContentResponse()
	detach(
		@Param("connectionId", ParseUUIDPipe) connectionId: string,
		@Query() query: DetachHubMemberQueryDto,
	): Promise<void> {
		return this.hub.detach(connectionId, query.expectedHubRevision, query.runtimeGeneration);
	}

	@Get("catalog")
	@Header("Cache-Control", "no-store")
	@ApiOkResponse({ type: HubCatalogResponseDto })
	catalog(@Query() query: HubCatalogQueryDto) {
		return this.hub.catalog(query.expectedHubRevision);
	}

	@Post("catalog/refresh")
	@HttpCode(HttpStatus.OK)
	@ApiOkResponse({ type: HubResponseDto })
	refresh(@Body() body: RefreshHubCatalogDto) {
		return this.hub.refresh(body.expectedHubRevision);
	}
}
