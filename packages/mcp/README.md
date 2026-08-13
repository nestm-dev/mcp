# @nestm/mcp

NestJS 12 integration for the official Model Context Protocol TypeScript SDK v2.

```ts
import { Injectable, Module } from "@nestjs/common";
import { McpModule, McpTool, fromJsonSchema } from "@nestm/mcp";

@Injectable()
class ArtifactTools {
	@McpTool({
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
			servers: [
				{
					name: "artifact",
					serverInfo: { name: "artifact", version: "1.0.0" },
				},
			],
			clients: [
				{
					name: "knowledge",
					transport: { kind: "http", url: "https://mcp.example.com/mcp" },
				},
			],
			connectClientsOnBootstrap: true,
		}),
	],
	providers: [ArtifactTools],
})
export class AppModule {}
```

Async configuration supports normal Nest imports and injection:

```ts
McpModule.forRootAsync({
	imports: [RuntimeConfigModule],
	inject: [RuntimeConfigService],
	useFactory: (config: RuntimeConfigService) => ({
		clients: config.mcpServers(),
		connectClientsOnBootstrap: true,
	}),
	isGlobal: false,
});
```

After Nest application bootstrap, inject `McpRuntimeService`. Mount
`runtime.server("artifact").toNodeHandler()` at the desired route, access the named upstream with
`runtime.client("knowledge")`, or use `runtime.clients` for registry operations. The module closes
inbound server handlers before upstream clients during Nest shutdown.

Decorated singleton providers with static dependency trees are compiled once. The official SDK
still creates a fresh cheap server instance for every modern HTTP request. `@McpTool`,
`@McpPrompt`, and `@McpResource` preserve the official callback types: a schema-incompatible
method signature is rejected by TypeScript before reflective discovery runs.

## Validated handler pipeline

Each Nest server definition can apply policy around its decorated callbacks:

```ts
import { McpModule, allowMcpOperation, denyMcpOperation } from "@nestm/mcp";

McpModule.forRoot({
	servers: [
		{
			name: "artifact",
			serverInfo: { name: "artifact", version: "1.0.0" },
			handlerAuthorization: {
				authorize(operation) {
					const principal = operation.context.principal;
					return principal?.scopes.includes("artifacts:read") === true
						? allowMcpOperation({ policy: "artifact-scopes-v1" })
						: denyMcpOperation("The required artifact scope is missing.");
				},
			},
			handlerMiddleware: [deadlineMiddleware, auditMiddleware],
			handlerLifecycleObserver: lifecycleObserver,
		},
	],
});
```

The official SDK first validates arguments and resolves the registered tool, resource, or prompt.
NestM then creates `McpHandlerInvocationInput` from that trusted callback definition and the
official server context. The pipeline runs in this order:

1. `handlerLifecycleObserver` surrounds the complete invocation and records denials.
2. `handlerAuthorization` runs before all custom handler middleware and cannot be bypassed by a
   short-circuiting middleware.
3. `handlerMiddleware` applies application policy.
4. The decorated provider method runs.

This handler pipeline works for HTTP and stdio. Callback arguments and results are absent from
lifecycle events, and an authenticated HTTP principal is projected without its bearer token or
arbitrary token metadata.

`McpServerDefinition.middleware` is intentionally different: it surrounds a complete HTTP
exchange before official dispatch and does not run for stdio. Use it for exchange-level concerns,
not as the sole authorization seam for individual capabilities. A raw Node handler mounted beside
Nest routes also does not automatically execute Nest guards or interceptors.

## Agent gateways and observability

`@nestm/mcp-gateway` exposes an `McpServerFeature`, so a policy-enforced aggregate gateway can be
included in a Nest server's `features`. The gateway projects tools, prompts, concrete resources,
resource templates, and completion from official or first-party client connections while keeping
downstream and upstream credentials separate. `McpRuntimeService.clients` provides the Nest-owned
named client runtime for application services and agent orchestration.

For the common case, declare the gateway directly on a Nest server. Its upstreams resolve against
the same module-owned client registry and unknown client names fail during bootstrap:

```ts
McpModule.forRoot({
	clients: upstreamServers,
	connectClientsOnBootstrap: true,
	servers: [
		{
			name: "agent-gateway",
			serverInfo: { name: "agent-gateway", version: "1.0.0" },
			gateway: {
				upstreams: ["artifact-storage", { clientName: "knowledge", gatewayName: "kb" }],
				policy: gatewayPolicy,
			},
		},
	],
});
```

Gateway servers are dedicated in this alpha. Do not target the same server with `@McpTool`,
`@McpPrompt`, or `@McpResource`, or install another feature that owns projected capability
handlers/list-change semantics. Nest rejects decorated-handler mixing during bootstrap; the
framework-neutral gateway rejects other handler ownership with `CAPABILITY_CONFLICT` when the
per-request SDK server is built.

Because an omitted decorator `servers` target means every configured non-gateway server, modules
that define a gateway alongside local servers should explicitly set `servers` on each decorated
handler. This keeps the dedicated gateway out of the handler's target set.

The string and `{ clientName }` forms deliberately treat each named `McpClientRuntime` connection
as an upstream service identity; they never forward the downstream bearer token. The same
declarative `upstreams` array can instead contain a complete `{ name, client: resolver }` gateway
upstream when an application needs authorization-aware token exchange or a tenant/user-owned
connection. The resolver receives the verified downstream request context; it must perform an
audience-checked exchange or select an already isolated client rather than forwarding the bearer
token unchanged.

After bootstrap, `McpRuntimeService.gateway(serverName)` returns the gateway owned by that inbound
server, including `invalidateDiscovery()`. `listGateways()` provides a frozen operational snapshot.
Application shutdown closes inbound server handlers before their upstream client connections.
Nest lifecycle cleanup contains errors so adapter disposal can finish; `shutdownError` retains the aggregate,
while an explicit `runtime.close()` rejects when the host wants strict cleanup handling.
Call `app.enableShutdownHooks()` when process signals should invoke this lifecycle. Bootstrap failure rolls
back any client/server runtimes that were already initialized.

Resource templates and prompt/template completion are projected by the gateway. Transparent
`input_required` relaying and notification bridging remain explicit future layers because they
require sealed route-bound state and long-lived, authorization-partitioned subscription
coordination.

`@nestm/mcp-observability` provides bounded structured-log and metrics observers plus tracing
middleware. Pass its lifecycle observers to `clientRuntime.observer`,
`handlerLifecycleObserver`, or `McpServerDefinition.lifecycleObserver`, and pass tracing middleware to the
matching logical middleware list. Its default attribute projection excludes principals, payloads,
request/session identifiers, error messages, stacks, and credentials.

For HTTP bearer authentication and protected-resource metadata, wrap the mounted runtime with
`@nestm/mcp-server/auth`. OAuth authentication establishes identity; `handlerAuthorization` still
decides whether that identity may invoke a specific capability.
