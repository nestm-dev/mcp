import { Test } from "@nestjs/testing";
import type { FetchLike } from "@modelcontextprotocol/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ControlPlaneConfigService } from "../src/config/control-plane-config.service.ts";
import { McpEndpointAdmissionService } from "../src/runtime/mcp-endpoint-admission.service.ts";
import { MCP_CONTROL_PLANE_BASE_FETCH } from "../src/runtime/runtime.types.ts";

describe("McpEndpointAdmissionService", () => {
	let service: McpEndpointAdmissionService;
	let baseFetch: FetchLike;

	beforeEach(async () => {
		baseFetch = vi.fn(async () => new Response(null, { status: 204 }));
		const module = await Test.createTestingModule({
			providers: [
				McpEndpointAdmissionService,
				{
					provide: ControlPlaneConfigService,
					useValue: {
						allowedHosts: ["127.0.0.1", "localhost", "mcp.example.test"],
						allowLoopbackHttp: true,
					},
				},
				{ provide: MCP_CONTROL_PLANE_BASE_FETCH, useValue: baseFetch },
			],
		}).compile();
		service = module.get(McpEndpointAdmissionService);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("admits exact HTTPS hosts and loopback HTTP while canonicalizing the endpoint", () => {
		expect(service.admit("https://mcp.example.test/service")).toEqual({
			url: "https://mcp.example.test/service",
			host: "mcp.example.test",
		});
		expect(service.admit("http://127.0.0.1:4321/mcp")).toEqual({
			url: "http://127.0.0.1:4321/mcp",
			host: "127.0.0.1:4321",
		});
	});

	it.each([
		"https://not-allowed.example.test/mcp",
		"http://mcp.example.test/mcp",
		"https://user:secret@mcp.example.test/mcp",
		"https://mcp.example.test/mcp?token=secret",
		"https://mcp.example.test/mcp#fragment",
	])("rejects an endpoint outside the admitted, secret-free boundary: %s", (endpoint) => {
		expect(() => service.admit(endpoint)).toThrowError(
			expect.objectContaining({ code: "MCP_ENDPOINT_REJECTED" }),
		);
	});

	it("rejects cross-origin transport fetches and redirects", async () => {
		const guarded = service.createFetch("https://mcp.example.test/mcp");
		await expect(guarded("https://not-allowed.example.test/mcp")).rejects.toMatchObject({
			code: "MCP_ENDPOINT_REJECTED",
		});

		baseFetch = vi.fn(
			async () =>
				new Response(null, {
					status: 307,
					headers: { location: "https://mcp.example.test/other" },
				}),
		);
		const module = await Test.createTestingModule({
			providers: [
				McpEndpointAdmissionService,
				{
					provide: ControlPlaneConfigService,
					useValue: { allowedHosts: ["mcp.example.test"], allowLoopbackHttp: false },
				},
				{ provide: MCP_CONTROL_PLANE_BASE_FETCH, useValue: baseFetch },
			],
		}).compile();
		const redirectGuard = module
			.get(McpEndpointAdmissionService)
			.createFetch("https://mcp.example.test/mcp");

		await expect(redirectGuard("https://mcp.example.test/mcp")).rejects.toMatchObject({
			code: "MCP_ENDPOINT_REJECTED",
		});
	});
});
