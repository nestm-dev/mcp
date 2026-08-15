import {
	CallHandler,
	CanActivate,
	Controller,
	ExecutionContext,
	Inject,
	INestApplication,
	Injectable,
	NestInterceptor,
	UseInterceptors,
	VersioningType,
} from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { Test, type TestingModule } from "@nestjs/testing";
import { ExpressAdapter } from "@nestjs/platform-express";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { Observable } from "rxjs";
import type { AuthInfo, OAuthTokenVerifier } from "@modelcontextprotocol/server";
import type { McpServerMiddleware, McpServerRuntime } from "@nestm/mcp-server";
import { McpResourceServer } from "@nestm/mcp-server/auth";
import { McpValidatedServer } from "@nestm/mcp-server/security";
import { describe, expect, it, vi } from "vitest";
import { McpModule } from "../src/mcp.module.ts";
import { McpHttpControllerFor } from "../src/mcp-http.controller.ts";
import { McpRuntimeService } from "../src/mcp-runtime.service.ts";

type NestPlatform = "express" | "fastify";

@Injectable()
class ControllerTraceInterceptor implements NestInterceptor {
	readonly paths: string[] = [];

	intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
		const request = context.switchToHttp().getRequest<{ readonly url: string }>();
		this.paths.push(request.url);
		return next.handle();
	}
}

describe("McpHttpController", () => {
	it("rejects an empty named-server binding", () => {
		expect(() => McpHttpControllerFor("  ")).toThrowError(/non-empty string/);
	});

	it("lets a subclass short-circuit through Nest before MCP owns the response", async () => {
		const ControllerBase = McpHttpControllerFor("controller-server");
		@Controller("mcp")
		class InterceptingController extends ControllerBase {
			protected override interceptMcpRequest(): unknown {
				return { source: "nest" };
			}
		}
		const testingModule = await Test.createTestingModule({
			imports: [
				McpModule.forRoot({
					autoDiscover: false,
					servers: [
						{
							name: "controller-server",
							serverInfo: { name: "controller-server", version: "1.0.0" },
						},
					],
				}),
			],
			controllers: [InterceptingController],
		}).compile();
		const application = testingModule.createNestApplication();
		await application.listen(0, "127.0.0.1");
		try {
			const response = await fetch(`${await application.getUrl()}/mcp`);
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({ source: "nest" });
		} finally {
			await application.close();
		}
	});

	it.each<NestPlatform>(["express", "fastify"])(
		"mounts through Nest %s with path, version, global guard, and fetch wrappers intact",
		async (platform) => {
			const middlewareToken = Symbol(`HTTP_MIDDLEWARE_${platform}`);
			const verifierToken = Symbol(`HTTP_TOKEN_VERIFIER_${platform}`);
			const guardPaths: string[] = [];
			const guard: CanActivate = {
				canActivate(context) {
					const request = context.switchToHttp().getRequest<{
						readonly headers: Readonly<Record<string, string | string[] | undefined>>;
						readonly url: string;
					}>();
					guardPaths.push(request.url);
					return request.headers["x-controller-access"] === "allowed";
				},
			};
			const verifyAccessToken = vi.fn(async (token: string): Promise<AuthInfo> => ({
				token,
				clientId: "nest-http-client",
				scopes: ["mcp:invoke"],
				expiresAt: Math.floor(Date.now() / 1_000) + 60,
			}));
			const verifier: OAuthTokenVerifier = { verifyAccessToken };
			const runtimeRequests: string[] = [];
			const middleware: McpServerMiddleware = async (operation) => {
				const request = operation.input.request;
				const body = await request.text();
				const path = new URL(request.url).pathname;
				const principal = operation.context.principal?.clientId ?? "anonymous";
				const summary = `${request.method}:${path}:${body}:${principal}`;
				runtimeRequests.push(summary);
				return new Response(summary, {
					status: 202,
					headers: { "content-type": "text/plain" },
				});
			};

			@Injectable()
			class HttpHandlerComposition {
				constructor(@Inject(verifierToken) private readonly tokenVerifier: OAuthTokenVerifier) {}

				create(runtime: McpServerRuntime): McpValidatedServer {
					return new McpValidatedServer(
						new McpResourceServer(runtime, {
							bearerAuth: { verifier: this.tokenVerifier, requiredScopes: ["mcp:invoke"] },
						}),
						{
							allowedHostnames: ["127.0.0.1"],
							allowedOriginHostnames: ["127.0.0.1"],
						},
					);
				}
			}

			const ControllerBase = McpHttpControllerFor("controller-server");

			@Controller({ path: "agents/mcp", version: "1" })
			@UseInterceptors(ControllerTraceInterceptor)
			class HostedMcpController extends ControllerBase {
				constructor(
					runtimeService: McpRuntimeService,
					private readonly composition: HttpHandlerComposition,
				) {
					super(runtimeService);
				}

				protected override createMcpHttpHandler(runtime: McpServerRuntime): McpValidatedServer {
					return this.composition.create(runtime);
				}
			}

			const testingModule = await Test.createTestingModule({
				imports: [
					McpModule.forRoot({
						autoDiscover: false,
						collaborators: {
							providers: [{ provide: middlewareToken, useValue: { handle: middleware } }],
						},
						servers: [
							{
								name: "controller-server",
								serverInfo: { name: "controller-server", version: "1.0.0" },
								middleware: [middlewareToken],
							},
						],
					}),
				],
				controllers: [HostedMcpController],
				providers: [
					ControllerTraceInterceptor,
					HttpHandlerComposition,
					{ provide: APP_GUARD, useValue: guard },
					{ provide: verifierToken, useValue: verifier },
				],
			}).compile();
			const application = createApplication(testingModule, platform);
			application.setGlobalPrefix("api");
			application.enableVersioning({ type: VersioningType.URI });
			await application.listen(0, "127.0.0.1");

			try {
				const baseUrl = await application.getUrl();
				const route = `${baseUrl}/api/v1/agents/mcp`;
				const missingVersion = await fetch(`${baseUrl}/api/agents/mcp`, {
					headers: {
						authorization: "Bearer test-token",
						"x-controller-access": "allowed",
					},
				});
				expect(missingVersion.status).toBe(404);

				const blockedByGlobalGuard = await fetch(route);
				expect(blockedByGlobalGuard.status).toBe(403);
				expect(verifyAccessToken).not.toHaveBeenCalled();

				const blockedByOriginValidation = await fetch(route, {
					headers: {
						authorization: "Bearer test-token",
						origin: "https://evil.example",
						"x-controller-access": "allowed",
					},
				});
				expect(blockedByOriginValidation.status).toBe(403);
				expect(verifyAccessToken).not.toHaveBeenCalled();

				const blockedByBearerAuth = await fetch(route, {
					headers: { "x-controller-access": "allowed" },
				});
				expect(blockedByBearerAuth.status).toBe(401);
				expect(runtimeRequests).toEqual([]);

				const postResponse = await fetch(route, {
					method: "POST",
					headers: {
						authorization: "Bearer test-token",
						"content-type": "application/json",
						"x-controller-access": "allowed",
					},
					body: JSON.stringify({ hello: "world" }),
				});
				expect(postResponse.status).toBe(202);
				expect(await postResponse.text()).toBe(
					'POST:/api/v1/agents/mcp:{"hello":"world"}:nest-http-client',
				);

				const deleteResponse = await fetch(route, {
					method: "DELETE",
					headers: {
						authorization: "Bearer test-token",
						"x-controller-access": "allowed",
					},
				});
				expect(deleteResponse.status).toBe(202);
				expect(await deleteResponse.text()).toBe("DELETE:/api/v1/agents/mcp::nest-http-client");

				expect(verifyAccessToken).toHaveBeenCalledTimes(2);
				expect(verifyAccessToken).toHaveBeenNthCalledWith(1, "test-token");
				expect(runtimeRequests).toEqual([
					'POST:/api/v1/agents/mcp:{"hello":"world"}:nest-http-client',
					"DELETE:/api/v1/agents/mcp::nest-http-client",
				]);
				expect(guardPaths).toContain("/api/v1/agents/mcp");
				expect(application.get(ControllerTraceInterceptor).paths).toEqual([
					"/api/v1/agents/mcp",
					"/api/v1/agents/mcp",
					"/api/v1/agents/mcp",
					"/api/v1/agents/mcp",
				]);
			} finally {
				await application.close();
			}
		},
	);
});

function createApplication(testingModule: TestingModule, platform: NestPlatform): INestApplication {
	return platform === "fastify"
		? testingModule.createNestApplication(new FastifyAdapter())
		: testingModule.createNestApplication(new ExpressAdapter());
}
