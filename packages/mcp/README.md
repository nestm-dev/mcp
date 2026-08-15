# @nestm/mcp

NestJS 12 integration for the official Model Context Protocol TypeScript SDK v2.

The package root is intentionally Nest-focused. Import framework-neutral runtime, transport,
gateway, authentication, and observability APIs from their owning `@nestm/mcp-*` packages.

```ts
import { Injectable, Module } from "@nestjs/common";
import { McpClientModule, McpModule, Tool, fromJsonSchema } from "@nestm/mcp";

@Injectable()
class ArtifactTools {
	@Tool({
		name: "artifact.read",
		inputSchema: fromJsonSchema<{ id: string }>({
			type: "object",
			properties: { id: { type: "string" } },
			required: ["id"],
		}),
	})
	read({ id }: { id: string }) {
		return { content: [{ type: "text" as const, text: id }] };
	}
}

@Module({
	imports: [
		McpModule.forRoot({
			imports: [
				McpClientModule.forRoot({
					servers: [
						{
							name: "knowledge",
							transport: { kind: "http", url: "https://mcp.example.com/mcp" },
						},
					],
					connectOnApplicationBootstrap: true,
				}),
			],
			servers: [
				{
					name: "artifact",
					serverInfo: { name: "artifact", version: "1.0.0" },
				},
			],
		}),
	],
	providers: [ArtifactTools],
})
export class AppModule {}
```

Configure upstream clients asynchronously with normal Nest imports and injection, then import that
configured client module through the MCP server root:

```ts
McpModule.forRoot({
	imports: [
		McpClientModule.forRootAsync({
			imports: [RuntimeConfigModule],
			inject: [RuntimeConfigService],
			useFactory: (config: RuntimeConfigService) => ({
				servers: config.mcpServers(),
				connectOnApplicationBootstrap: true,
			}),
		}),
	],
});
```

Use `McpModule.forRootAsync()` separately when inbound server definitions are asynchronous.
`McpModule` and `McpClientModule` are both local by default. Import the MCP server root exactly once
per Nest application because decorator discovery is application-wide. Configure the client module
independently and include it in `McpModule`'s `imports` when gateways or `McpRuntimeService` need its
named upstreams. Set `isGlobal: true` on either module only when application-wide injection is
intentional.

After Nest application bootstrap, inject `McpRuntimeService`. Mount
`runtime.server("artifact").toNodeHandler()` at the desired route, access the named upstream with
`runtime.client("knowledge")`, or use `runtime.clients` for registry operations. The module closes
inbound server handlers before upstream clients during Nest shutdown. For Nest-native routing,
guards, interceptors, prefixes, and versioning, prefer `McpHttpControllerFor()` below.

For an outbound-only agent host, import `McpClientModule` directly and inject `McpClientService`:

```ts
import { Injectable, Module } from "@nestjs/common";
import { McpClientModule, McpClientService } from "@nestm/mcp";

@Injectable()
class KnowledgeAgent {
	constructor(private readonly clients: McpClientService) {}

	listTools() {
		return this.clients.listTools("knowledge");
	}
}

@Module({
	imports: [
		McpClientModule.forRoot({
			servers: upstreamServers,
			connectOnApplicationBootstrap: true,
		}),
	],
	providers: [KnowledgeAgent],
})
export class AgentHostModule {}
```

`McpClientService` extends the framework-neutral `McpClientRuntime`, so it exposes the same typed
registry and protocol operations while adding Nest bootstrap and shutdown ownership. Client
factories, transports, authentication, middleware, observers, and resolvers are referenced by
provider token and registered under `McpClientModule`'s `collaborators`; the module resolves and
binds them before constructing the runtime. Outside Nest, continue constructing `McpClientRuntime`
directly from `@nestm/mcp-client`.

The client adapter resolves these provider-token seams:

| Client option                                 | Provider contract                                      |
| --------------------------------------------- | ------------------------------------------------------ |
| `runtime.clientFactory`                       | `createClient`                                         |
| `runtime.transportFactory` / server factory   | `createTransport`                                      |
| `runtime.middleware[]`                        | `handle`                                               |
| `runtime.observer`                            | `onEvent`                                              |
| `runtime.lifecycle.clock` / `runtime.clock`   | `now`                                                  |
| `runtime.lifecycle.errorReporter`             | `report`                                               |
| `runtime.principalResolver`                   | `resolvePrincipal`                                     |
| `runtime.attributesResolver`                  | `resolveAttributes`                                    |
| `runtime.operationIdFactory`                  | `createOperationId`                                    |
| `servers[].configureClient`                   | `configure`                                            |
| `servers[].clientOptions.jsonSchemaValidator` | `getValidator`                                         |
| `servers[].clientOptions.responseCacheStore`  | `get`, `set`, `delete`, `evict`, `clear`               |
| `servers[].connectOptions.progressObserver`   | `onProgress`                                           |
| HTTP `authProvider`                           | `token`, or the complete `OAuthClientProvider` methods |
| HTTP `fetch` / `middleware[]` / reconnection  | `fetch` / `handle` / `schedule`                        |
| HTTP `requestInit` / stdio `stderrStream`     | provider-owned value                                   |

Static connect configuration intentionally excludes `AbortSignal`; pass cancellation to an
imperative client operation instead. Passive URL, timeout, retry, stdio mode, and environment data
stays inline.

Decorated singleton providers with static dependency trees are compiled once. The official SDK
still creates a fresh cheap server instance for every modern HTTP request. `@Tool`, `@Prompt`, and
`@Resource` preserve the official callback types: a schema-incompatible
method signature is rejected by TypeScript before reflective discovery runs.

## Feature modules and server targeting

Keep handler providers and their dependencies in feature modules while configuring the shared
runtime once with `forRoot()`:

```ts
import { Injectable, Module } from "@nestjs/common";
import { Targets, Tool } from "@nestm/mcp";

@Injectable()
@Targets("artifact", "backoffice")
class ArtifactTools {
	@Tool({ name: "artifact.read" })
	read() {
		return { content: [{ type: "text" as const, text: "read" }] };
	}

	// Method targets replace, rather than merge with, the class defaults.
	@Tool({ name: "artifact.delete", servers: "backoffice" })
	remove() {
		return { content: [{ type: "text" as const, text: "removed" }] };
	}
}

@Module({
	imports: [ArtifactStoreModule],
	providers: [ArtifactTools],
	exports: [ArtifactTools],
})
export class ArtifactMcpFeatureModule {}
```

Use ordinary Nest modules for imports, providers, and explicit exports; discovery scans registered
providers across the application. `@Targets()` supplies class defaults; a decorator's own
`servers` value replaces that default for the method. When neither is present, the capability
targets every configured server, so explicitly target local servers when a dedicated gateway is
configured. Empty, duplicate, unknown, and gateway targets are rejected.

### Injectable low-level contributors

When a capability cannot be expressed through decorators or `McpCapabilitiesService`, register a
singleton contributor provider explicitly:

```ts
import { Injectable, Module } from "@nestjs/common";
import { McpModule, type McpServerContributor } from "@nestm/mcp";

@Injectable()
class HealthContributor implements McpServerContributor {
	contribute: McpServerContributor["contribute"] = (server) => {
		server.registerTool("health.check", {}, async () => ({
			content: [{ type: "text", text: "ok" }],
		}));
	};
}

@Module({
	imports: [
		McpModule.forRoot({
			collaborators: { providers: [HealthContributor] },
			servers: [
				{
					name: "operations",
					serverInfo: { name: "operations", version: "1.0.0" },
					contributors: [HealthContributor],
				},
			],
		}),
	],
})
export class OperationsMcpModule {}
```

Contributors are the Nest boundary for low-level official SDK registration; raw server feature
callbacks remain in `@nestm/mcp-server`. Contributors must use the default singleton scope and
cannot share a dedicated gateway or catalog-projected server.

All callback-bearing Nest server settings are provider tokens resolved once during bootstrap:

| Server option                         | Required provider method(s) |
| ------------------------------------- | --------------------------- |
| `serverOptions.jsonSchemaValidator`   | `getValidator`              |
| `serverOptions.requestState.verifier` | `verify`                    |
| `http.eventBus`                       | `publish`, `subscribe`      |
| `principalClaims`                     | `resolvePrincipalClaims`    |
| `middleware[]`                        | `handle`                    |
| `lifecycleObserver`                   | `onEvent`                   |
| `observer`                            | `observe`                   |
| `onError`                             | `report`                    |
| `handlerAuthorization`                | `authorize`                 |
| `handlerMiddleware[]`                 | `handle`                    |
| `handlerLifecycleObserver`            | `onEvent`                   |
| `contributors[]`                      | `contribute`                |
| `catalogExposure.policy`              | `resolve`                   |

The declarative Nest gateway follows the same rule:

| Gateway option                         | Required provider method(s)                                                               |
| -------------------------------------- | ----------------------------------------------------------------------------------------- |
| `gateway.upstreams[].clientProvider`   | `resolveClient`                                                                           |
| `gateway.policy`                       | `authorize`; optional `authorizePrompt`, `authorizeResource`, `authorizeResourceTemplate` |
| `gateway.nameCodec`                    | `encode`, `decode`, `tryDecode`                                                           |
| `gateway.promptNameCodec`              | `encode`, `decode`, `tryDecode`                                                           |
| `gateway.resourceUriCodec`             | `encode`, `decode`, `tryDecode`                                                           |
| `gateway.resourceTemplateUriCodec`     | `encode`, `decode`, `tryDecode`                                                           |
| `gateway.resourceTemplateNameCodec`    | `encode`, `decode`, `tryDecode`                                                           |
| `gateway.discoveryCache`               | `get`, `set`, `delete`, `clear`                                                           |
| `gateway.authorizationContextResolver` | `resolveAuthorizationContext`                                                             |
| `gateway.middleware[]`                 | `handle`                                                                                  |
| `gateway.lifecycleObserver`            | `onEvent`                                                                                 |
| `gateway.onObserverError`              | `report`                                                                                  |

Use a class token, string token, symbol token, or abstract-class token registered under
`McpModule`'s `collaborators.providers`. Use `collaborators.imports` for modules that supply their
dependencies; imported providers can be exposed through `useExisting`. This explicit child-module
ownership prevents an identically named private provider elsewhere in the application from being
selected and keeps collaborator initialization/teardown ordered around the runtimes they serve.
Collaborators must use the default singleton scope with a static dependency tree; bootstrap fails
before serving traffic when a token is missing, scoped, or does not implement its required method.
The Nest option names make token ownership explicit: `http.eventBus` maps to the official handler's
`bus`, and `serverOptions.requestState.verifier` supplies its `verify` callback. Passive data such as
timeouts, limits, cache hints, and other scalar server or gateway settings remains inline. When
constructing `McpServerRuntime` or `McpGateway` outside Nest, pass the raw callback-bearing options
defined by `@nestm/mcp-server` and `@nestm/mcp-gateway` instead.

## Per-request capability visibility

Visibility controls which capabilities are installed on a freshly built server; it does not
authorize invocation:

```ts
import { Injectable } from "@nestjs/common";
import { Tool, type McpCapabilityVisibilityPolicy, type McpServerBuildContext } from "@nestm/mcp";

@Injectable()
class ArtifactVisibility implements McpCapabilityVisibilityPolicy {
	isVisible(context: Readonly<McpServerBuildContext>): boolean {
		return context.principal?.tenantId === "artifact-team";
	}
}

@Injectable()
class InternalArtifactTools {
	@Tool({
		name: "artifact.internal",
		visibility: ArtifactVisibility,
	})
	internalArtifact() {
		return { content: [{ type: "text" as const, text: "internal" }] };
	}
}
```

Register policy classes as default-scope singleton `McpModule` collaborators.
Each policy is evaluated once per fresh server build and shared by every capability that references
it. Static `true`/`false` visibility is also supported. A missing or non-singleton provider,
exception, rejection, non-boolean result, request abort, or deadline aborts the server build
fail-closed. The visibility wave defaults to 30 seconds and is configured per server with
`handlerVisibilityTimeoutMs`.

Always use `handlerAuthorization` independently for call-time access decisions. Hiding a tool,
prompt, or resource from discovery is not an authorization boundary.

## Authorization-safe tool catalogs

`McpNestServerDefinition.catalogExposure` is an opt-in projection applied after the complete
per-request visibility wave:

- `eager` lists every currently visible tool normally.
- `search` keeps selected tools eager and merges application-supplied deferred metadata into the
  other visible definitions. No vendor metadata is added unless this strategy is configured.
- `lazy` keeps selected tools eager and adds the bounded `nestm.catalog.search` and
  `nestm.catalog.schemas` tools. Search results are cursor-paginated against the exact ordered
  visible snapshot; schema fetches accept a bounded name batch and return official MCP `Tool`
  definitions.

Eager selectors can match an exact name, a normalized `ToolOptions.tags` value, or a readonly
predicate. Dynamic strategy selection belongs to a singleton `McpCatalogExposurePolicy` provider;
its `resolve()` input contains frozen public tool projections plus the token-free principal,
runtime name, protocol era, and abort signal. It never exposes decorated callbacks, visibility
providers, raw requests, or bearer credentials.

```ts
import { Injectable } from "@nestjs/common";
import type {
	McpCatalogExposurePolicy,
	McpCatalogExposureStrategy,
	McpNestCatalogExposureOptions,
} from "@nestm/mcp";

@Injectable()
class ArtifactCatalogPolicy implements McpCatalogExposurePolicy {
	resolve: McpCatalogExposurePolicy["resolve"] = (input): McpCatalogExposureStrategy => {
		return input.principal?.scopes.includes("tools:discover-all")
			? { kind: "eager" }
			: {
					kind: "lazy",
					eager: [{ kind: "tag", tag: "essential" }],
				};
	};
}

const catalogExposure = {
	policy: ArtifactCatalogPolicy,
} satisfies McpNestCatalogExposureOptions;
```

Register `ArtifactCatalogPolicy` under `McpModule`'s `collaborators.providers` and assign
`catalogExposure` to the server definition.

Each lazy meta-tool closes over the exact visible snapshot belonging to that fresh server build.
Unknown and hidden names are indistinguishable to schema fetches, concurrent builds do not share
catalog state, and list/search cursors are rejected if reused after the ordered visible snapshot
changes. Deferred tools plus both meta-tools still enter the normal
`handlerAuthorization` pipeline when called. Lazy meta-tool names are reserved on every
catalog-enabled runtime. Catalog exposure cannot share a runtime with a gateway or custom
`contributors`: the SDK exposes no public tool-enumeration seam for safely projecting those
registrations, so bootstrap rejects that composition instead of silently dropping tools.

## Live capability registration

After application bootstrap, inject the public capability service:

```ts
import { McpCapabilitiesService } from "@nestm/mcp";

const capabilities = app.get(McpCapabilitiesService);

const refresh = capabilities.registerTool(
	{ name: "artifact.refresh", servers: "artifact" },
	async () => ({ content: [{ type: "text" as const, text: "refreshed" }] }),
);

refresh.replace(async () => ({
	content: [{ type: "text" as const, text: "refreshed-v2" }],
}));
refresh.unregister();
```

`McpRuntimeService.capabilities` references the same service for runtime-oriented code.

`registerTool()`, `registerPrompt()`, and `registerResource()` use the same targeting, visibility,
collision, and callback types as decorators. A registration handle atomically replaces only its
callback or unregisters that exact entry; either operation returns `false` once the handle is no
longer active. Mutations use copy-on-write snapshots: a server build keeps the capabilities it
started with, while later builds see the new snapshot. Successful register, replace, and unregister
operations publish the matching tools, prompts, or resources list-change notification to every
targeted runtime.

Once runtime shutdown begins, the service is sealed: new registrations and active-handle
`replace()`/`unregister()` calls throw `McpModuleError` with code `RUNTIME_CLOSED`.

## Validated handler pipeline

Each Nest server definition can apply policy around its decorated callbacks:

```ts
import { Injectable, Module } from "@nestjs/common";
import {
	McpModule,
	allowMcpOperation,
	denyMcpOperation,
	type McpHandlerAuthorizationPolicy,
} from "@nestm/mcp";

@Injectable()
class ArtifactHandlerPolicy implements McpHandlerAuthorizationPolicy {
	authorize: McpHandlerAuthorizationPolicy["authorize"] = (operation) => {
		return operation.context.principal?.scopes.includes("artifacts:read") === true
			? allowMcpOperation({ policy: "artifact-scopes-v1" })
			: denyMcpOperation("The required artifact scope is missing.");
	};
}

@Module({
	imports: [
		McpModule.forRoot({
			collaborators: {
				providers: [
					ArtifactHandlerPolicy,
					DeadlineMiddleware,
					AuditMiddleware,
					ArtifactLifecycleObserver,
				],
			},
			servers: [
				{
					name: "artifact",
					serverInfo: { name: "artifact", version: "1.0.0" },
					handlerAuthorization: ArtifactHandlerPolicy,
					handlerMiddleware: [DeadlineMiddleware, AuditMiddleware],
					handlerLifecycleObserver: ArtifactLifecycleObserver,
				},
			],
		}),
	],
})
export class ArtifactMcpModule {}
```

The official SDK first validates arguments and resolves the registered tool, resource, or prompt.
NestM then creates `McpHandlerInvocationInput` from that trusted callback definition and the
official server context. The pipeline runs in this order:

1. `handlerLifecycleObserver` surrounds the complete invocation and records denials.
2. `handlerAuthorization` runs before all custom handler middleware and cannot be bypassed by a
   short-circuiting middleware.
3. `handlerMiddleware` applies application policy.
4. The decorated provider method runs.

Transforming handler middleware is typed to the official tool, prompt, and resource result union.
For logging, tracing, and other concerns that must preserve the exact downstream result, use
`createMcpHandlerPassthroughMiddleware()`; its continuation is result-opaque and mandatory.

This handler pipeline works for HTTP and stdio. Callback arguments and results are absent from
lifecycle events, and an authenticated HTTP principal is projected without its bearer token or
arbitrary token metadata.

A server's injectable `middleware` providers are intentionally different: they surround a complete
HTTP exchange before official dispatch and do not run for stdio. Use them for exchange-level
concerns, not as the sole authorization seam for individual capabilities. A raw Node handler
mounted beside Nest routes also does not automatically execute Nest guards or interceptors.

## Nest-native HTTP controller

Bind a named runtime to a normal Nest controller when MCP should participate in the application's
HTTP route pipeline:

```ts
import { Controller, Injectable, Module, UseGuards } from "@nestjs/common";
import type { AuthInfo, OAuthTokenVerifier } from "@modelcontextprotocol/server";
import { McpHttpControllerFor, McpModule, McpRuntimeService } from "@nestm/mcp";
import type { McpServerRuntime } from "@nestm/mcp-server";
import { McpResourceServer } from "@nestm/mcp-server/auth";
import { McpValidatedServer } from "@nestm/mcp-server/security";

@Injectable()
class ArtifactTokenVerifier implements OAuthTokenVerifier {
	verifyAccessToken(token: string): Promise<AuthInfo> {
		return verifyArtifactAccessToken(token);
	}
}

const ArtifactMcpControllerBase = McpHttpControllerFor("artifact");

@Controller({ path: "mcp", version: "1" })
@UseGuards(ArtifactRouteGuard)
class ArtifactMcpController extends ArtifactMcpControllerBase {
	constructor(
		runtimeService: McpRuntimeService,
		private readonly verifier: ArtifactTokenVerifier,
	) {
		super(runtimeService);
	}

	protected override createMcpHttpHandler(runtime: McpServerRuntime) {
		return new McpValidatedServer(
			new McpResourceServer(runtime, {
				bearerAuth: { verifier: this.verifier, requiredScopes: ["mcp:invoke"] },
			}),
			requestValidationOptions,
		);
	}
}

@Module({
	imports: [McpModule.forRoot(runtimeOptions)],
	controllers: [ArtifactMcpController],
	providers: [ArtifactTokenVerifier],
})
export class AppModule {}
```

The inherited catch-all route works with Express and Fastify and preserves Nest global prefixes,
versioning, guards, and interceptors while leaving HTTP method semantics to the MCP handler. Prefer
Nest guards for application route policy. `McpHttpControllerFor()` accepts only the named runtime;
the concrete controller composes framework-neutral `McpResourceServer` and `McpValidatedServer`
facades by overriding `createMcpHttpHandler()` with Nest-injected collaborators. Override
`getNodeAdapterOptions()` to observe failures in the Node/Web conversion layer through an injected
reporter.

For a Nest-native request-level short circuit, override `interceptMcpRequest()`. Returning a value
lets Nest serialize it through the normal response pipeline; returning `undefined` delegates to MCP.
Capability calls still use `handlerAuthorization`, `handlerMiddleware`, and
`handlerLifecycleObserver`, which work identically over HTTP and stdio. A full per-capability Nest
RPC lane (request-scoped providers, parameter pipes, and exception filters) is intentionally not
emulated through private Nest internals in this release.

## Agent gateways and observability

The Nest server's declarative `gateway` option installs a policy-enforced aggregate backed by the
module-owned clients. It projects tools, prompts, concrete resources, resource templates, and
completion while keeping downstream and upstream credentials separate. Import
`@nestm/mcp-gateway` directly only when building a framework-neutral gateway.
`McpRuntimeService.clients` provides the Nest-owned named client runtime for application services
and agent orchestration.

For the common case, declare the gateway directly on a Nest server. Its upstreams resolve against
the same module-owned client registry and unknown client names fail during bootstrap:

```ts
McpModule.forRoot({
	imports: [
		McpClientModule.forRoot({
			servers: upstreamServers,
			connectOnApplicationBootstrap: true,
		}),
	],
	collaborators: { providers: [AgentGatewayPolicy] },
	servers: [
		{
			name: "agent-gateway",
			serverInfo: { name: "agent-gateway", version: "1.0.0" },
			gateway: {
				upstreams: ["artifact-storage", { clientName: "knowledge", gatewayName: "kb" }],
				policy: AgentGatewayPolicy,
			},
		},
	],
});
```

`AgentGatewayPolicy` is a default-scope provider implementing `McpGatewayPolicy`; register it under
`McpModule`'s `collaborators.providers`. The gateway resolves that token once during bootstrap. The
same applies to configured name/URI codecs, the discovery cache, authorization-context resolver,
middleware, lifecycle observer, and observer-error reporter: the `gateway` definition contains their
tokens, while `collaborators.providers` owns their singleton implementations. Numeric limits and
other passive gateway data stay inline. Raw implementations remain valid when constructing
`McpGateway` directly from `@nestm/mcp-gateway`.

Gateway servers are dedicated in this alpha. Do not target the same server with `@Tool`, `@Prompt`,
or `@Resource`, or configure a `contributor` that owns projected capability handlers/list-change
semantics. Nest rejects decorated or contributed handler mixing during bootstrap; the
framework-neutral gateway rejects other handler ownership with `CAPABILITY_CONFLICT` when the
per-request SDK server is built.

Because an omitted decorator target means every configured server, modules
that define a gateway alongside local servers should explicitly set `servers` on each decorated
handler. This keeps the dedicated gateway out of the handler's target set.

The string and `{ clientName }` forms deliberately treat each named `McpClientRuntime` connection
as an upstream service identity; they never forward the downstream bearer token. The same
declarative `upstreams` array can instead contain `{ name, clientProvider: ProviderToken }` when an
application needs authorization-aware token exchange or a tenant/user-owned connection. Register
an `McpGatewayClientProvider` under that token; its `resolveClient()` method receives the verified
downstream request context and must perform an audience-checked exchange or select an already
isolated client rather than forwarding the bearer token unchanged. Framework-neutral callers can
still pass a complete raw upstream directly to `McpGateway` from `@nestm/mcp-gateway`.

After bootstrap, `McpRuntimeService.gateway(serverName)` returns the gateway owned by that inbound
server, including `invalidateDiscovery()`. `listGateways()` provides a frozen operational snapshot.
Application shutdown closes inbound server handlers, then their gateways, then upstream client
connections. Gateway shutdown cancels accepted work before client ownership is released.
Nest lifecycle cleanup contains errors so adapter disposal can finish; `shutdownError` retains the aggregate,
while an explicit `runtime.close()` rejects when the host wants strict cleanup handling.
Call `app.enableShutdownHooks()` when process signals should invoke this lifecycle. Bootstrap failure rolls
back any client/server runtimes that were already initialized.

Resource templates and prompt/template completion are projected by the gateway. Transparent
`input_required` relaying and notification bridging remain explicit future layers because they
require sealed route-bound state and long-lived, authorization-partitioned subscription
coordination.

`@nestm/mcp-observability` provides bounded structured-log and metrics observers plus tracing
middleware. Import it directly, then adapt its observers behind injectable server or client
collaborator tokens. Client observers are referenced from `McpClientModule`'s `runtime.observer`
option. The default attribute projection excludes principals, payloads, request/session identifiers,
error messages, stacks, and credentials.

For HTTP bearer authentication and protected-resource metadata, construct `McpResourceServer` from
`@nestm/mcp-server/auth` around the mounted runtime. OAuth authentication establishes identity;
`handlerAuthorization` still decides whether that identity may invoke a specific capability.
