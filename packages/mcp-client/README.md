# `@nestm/mcp-client`

A production-oriented, framework-neutral MCP client runtime for Node.js. It manages many named
upstream servers while keeping the official `@modelcontextprotocol/client` v2 `Client` available
for advanced protocol features.

This package is alpha. It targets Node.js 22.13 or newer, ESM, TypeScript 7, and the official MCP
client SDK `>=2 <3`.

## What it provides

- A registry of independently connected named servers
- Official Streamable HTTP and Node.js stdio transports
- `AuthProvider` and `OAuthClientProvider` pass-through for HTTP
- Official composable fetch middleware
- MCP v2 version negotiation in `auto` mode by default, with explicit legacy or pinned modes
- Discovery and host-managed `PriorDiscovery` reuse
- Shared `@nestm/mcp-core` operation middleware, authorization, and lifecycle observation
- Deterministic connect, disconnect, disconnect-all, close, and async-disposal behavior
- Introspection snapshots without exposing auth tokens or operation payloads
- Typed delegation for tools, resources, resource templates, prompts, completion, and liveness
- Method-keyed protocol requests, schema-validated extension requests, and notifications
- Runtime-owned modern listen streams plus explicit legacy resource subscriptions
- Direct typed access to each connected official SDK `Client`

## Install

```sh
pnpm add @nestm/mcp-client @modelcontextprotocol/client
```

## HTTP runtime

```ts
import { createMiddleware, withLogging } from "@modelcontextprotocol/client";
import { McpClientRuntime } from "@nestm/mcp-client";

const correlation = createMiddleware(async (next, input, init) => {
	const headers = new Headers(init?.headers);
	headers.set("x-runtime", "artifact-agents");
	return next(input, { ...init, headers });
});

const runtime = new McpClientRuntime({
	clientInfo: { name: "artifact-agent-runtime", version: "1.0.0" },
	servers: [
		{
			name: "knowledge",
			transport: {
				kind: "http",
				url: "https://mcp.example.com/mcp",
				authProvider: {
					token: async () => process.env.MCP_ACCESS_TOKEN,
				},
				middleware: [correlation, withLogging({ statusLevel: 400 })],
			},
		},
	],
});

await runtime.connect("knowledge");

const { tools } = await runtime.listTools("knowledge");
const result = await runtime.callTool("knowledge", {
	name: tools[0]!.name,
	arguments: { query: "MCP runtime architecture" },
});

await runtime.close();
```

`middleware` uses the official SDK's `applyMiddlewares` implementation. A custom `fetch` can be
provided as the base of that chain. Authentication is passed directly to
`StreamableHTTPClientTransport`; the runtime does not copy tokens into snapshots or lifecycle
events.

For machine-to-machine OAuth, the package re-exports the official v2 providers:

```ts
import { ClientCredentialsProvider, McpClientRuntime } from "@nestm/mcp-client";

const authProvider = new ClientCredentialsProvider({
	clientId: process.env.MCP_CLIENT_ID!,
	clientSecret: process.env.MCP_CLIENT_SECRET!,
	expectedIssuer: "https://identity.example.com",
	scope: "mcp:tools mcp:resources",
});

const runtime = new McpClientRuntime({
	servers: [
		{
			name: "secured",
			transport: {
				kind: "http",
				url: "https://mcp.example.com/mcp",
				authProvider,
			},
		},
	],
});
```

`PrivateKeyJwtProvider`, `StaticPrivateKeyJwtProvider`, `CrossAppAccessProvider`, the OAuth
discovery helpers, and the official typed OAuth errors are also available from the package root.
Interactive providers can be passed through in the same way; authorization redirects and durable
token storage remain host-application responsibilities.

## Stdio servers

```ts
const runtime = new McpClientRuntime({
	servers: [
		{
			name: "local-files",
			transport: {
				kind: "stdio",
				command: "node",
				args: ["./dist/files-server.mjs"],
				env: { MCP_ROOT: "/srv/artifacts" },
				stderr: "pipe",
			},
		},
	],
});

await runtime.connect("local-files");
```

The default factory returns the official `StdioClientTransport` class exactly. That matters for
the SDK's v2 automatic negotiation path, which can probe stdio through a short-lived sibling
process before opening the session process.

## Many servers

```ts
const runtime = new McpClientRuntime({
	servers: [githubDefinition, filesystemDefinition, databaseDefinition],
});

const clients = await runtime.connectAll({
	github: { timeout: 10_000 },
	database: { timeout: 5_000 },
});

for (const snapshot of runtime.snapshot()) {
	console.log(snapshot.name, snapshot.state, snapshot.protocolEra);
}
```

Concurrent calls to `connect(name)` share the same in-flight connection. Each server still owns a
separate SDK client, transport, session, negotiated protocol version, response cache, and failure
state. If any member of `connectAll()` fails, the runtime rolls back only connections whose atomic
connection transition was created by that `connectAll()` call. Connections that were already open
or won concurrently by another caller are preserved.

`unregister(name)` retires the logical entry before awaiting teardown. New and middleware-paused
operations can no longer reach that entry, in-flight connection setup is closed before removal,
and an old operation is never rerouted to a later same-name registration. Runtime `close()` uses
the same non-bypassable cleanup path and is safely idempotent even when middleware re-enters it.
Each connection attempt owns an abort signal, linked to the initiating caller's signal, which is
also passed to custom transport factories and the official SDK handshake. Disconnect, unregister,
and close abort that signal before waiting. `shutdownTimeoutMs` is one absolute deadline for the
entire teardown—connection quiescence, subscription handles, and official client/transport close
(30 seconds by default). A factory, subscription, or SDK/client implementation that ignores
cancellation cannot hang shutdown indefinitely: cleanup rejects with `MCP_CLIENT_SHUTDOWN_TIMEOUT`,
retains failures observed before the deadline, and detaches stale work so it can never publish a
connection later.

## Configure the official client

Use `configureClient` before connection to register SDK request handlers, notification handlers,
roots, elicitation, sampling, or other client capabilities. Use `requireClient` after connection
for any official API that the convenience delegates do not wrap.

```ts
const runtime = new McpClientRuntime({
	servers: [
		{
			name: "interactive",
			transport: { kind: "http", url: "https://mcp.example.com/mcp" },
			clientOptions: {
				capabilities: { elicitation: { form: {} } },
			},
			configureClient(client) {
				client.setRequestHandler("elicitation/create", async (request) => {
					return collectUserInput(request.params);
				});
			},
		},
	],
});

await runtime.connect("interactive");
const officialClient = runtime.requireClient("interactive");
```

The v2 SDK's modern protocol can also fulfill input-required rounds through these configured
handlers. The exact available handlers remain defined and typed by the official SDK.

### Manual input-required rounds

For an agent or UI that must approve each round itself, use the explicit manual APIs. They always
set the official per-request `allowInputRequired: true` flag, so the SDK returns the continuation
without dispatching configured elicitation, sampling, or roots handlers:

```ts
import { isInputRequiredResult, specTypeSchemas } from "@nestm/mcp-client";

const original = {
	method: "tools/call",
	params: { name: "publish-artifact", arguments: { artifactId } },
} as const;

const first = await runtime.requestWithInputRequired(
	"interactive",
	original,
	specTypeSchemas.CallToolResult,
);

if (isInputRequiredResult(first)) {
	const complete = await runtime.resumeInputRequired(
		"interactive",
		original,
		first,
		{ approval: { action: "accept", content: { approved: true } } },
		specTypeSchemas.CallToolResult,
	);
}
```

`resumeInputRequired` creates a fresh protocol request, echoes `requestState` byte-for-byte, and
sends only the current round's `inputResponses`; it never carries continuation fields retained on
the immutable original request. Treat both fields as untrusted server/client exchange data. The
server must integrity-protect and verify any state that affects authorization or business logic.
Re-authorize every round and apply a host-level round count and whole-flow deadline.

The manual option type is deliberately limited to official `RequestOptions` and does not claim
`CallToolRequestOptions.toolDefinition`. The typed continuation path uses the SDK's explicit-schema
request primitive; tool-specific SEP-2243 header mirroring and output-schema conveniences belong to
the SDK's `callTool()` path and are not silently approximated here.

## Completion and protocol extensions

Completion, ping, and all official method-keyed requests pass through the same runtime middleware
and lifecycle chain as tool calls:

```ts
const { completion } = await runtime.complete("interactive", {
	ref: { type: "ref/prompt", name: "review-code" },
	argument: { name: "language", value: "typ" },
});

const pong = await runtime.request("interactive", { method: "ping" });
```

Use `requestWithSchema` for a namespaced protocol extension. The official client validates the
response and TypeScript infers the output from the supplied Standard Schema:

```ts
const result = await runtime.requestWithSchema(
	"interactive",
	{ method: "acme/search", params: { query: "MCP" } },
	SearchResultSchema,
);
```

`notification(name, message, options)` is the corresponding one-way API. Both request forms and
notifications retain the protocol method in operation context without placing payloads in default
lifecycle events.

## Change subscriptions

Register notification handlers before connection, then open a modern MCP 2026-07-28 listen stream
through the runtime:

```ts
const runtime = new McpClientRuntime({
	servers: [
		{
			name: "catalog",
			transport: { kind: "http", url: "https://mcp.example.com/mcp" },
			configureClient(client) {
				client.setNotificationHandler("notifications/tools/list_changed", async () => {
					await refreshTools();
				});
			},
		},
	],
});

await runtime.connect("catalog");
const subscription = await runtime.listen("catalog", { toolsListChanged: true });

console.log(subscription.serverName, subscription.honoredFilter);
await subscription.close();
console.log(await subscription.closed); // "local"
```

`listen` returns a runtime-owned `McpClientSubscription`. Its `close()` is idempotent and observed
by middleware; `disconnect`, `unregister`, and runtime `close` gracefully close every still-active
runtime-owned stream before closing the official client. `activeSubscriptions(name)` provides a
read-only view for diagnostics. If `ClientOptions.listChanged` asks the SDK to open a stream during
connect, the runtime adopts that handle too and exposes it through `getAutoOpenedSubscription(name)`.
Subscription teardown is non-bypassable: middleware may observe, wrap, or reject the cleanup
operation, but the runtime still invokes the official handle's `close()` and reports both failures
when middleware and SDK cleanup fail.

The SDK intentionally keeps the eras explicit: `listen` is modern-only, while
`subscribeResource` and `unsubscribeResource` are the legacy per-resource requests. Calling one on
the wrong era preserves the official typed SDK error; this package does not silently translate
between their different delivery models.

## Operation middleware and observability

Every runtime connection action and delegated protocol request runs through `@nestm/mcp-core`.
Lifecycle events intentionally contain context and timing, not MCP request or response payloads.

```ts
import { createMcpAuthorizationMiddleware, type McpLifecycleObserver } from "@nestm/mcp-core";
import { McpClientRuntime } from "@nestm/mcp-client";

const observer: McpLifecycleObserver = {
	onEvent(event) {
		telemetry.record(event);
	},
};

const runtime = new McpClientRuntime({
	servers,
	principal: currentPrincipal,
	attributes: { deployment: "artifact-runtime" },
	middleware: [createMcpAuthorizationMiddleware(policy)],
	observer,
});
```

Middleware sees a stable `McpClientOperationInput` and context fields including `role: "client"`,
the protocol method, capability family, target server name, abort signal, session ID when known,
principal, and host attributes. Lifecycle observer failures are best-effort and do not replace the
operation result.

## Discovery and prior verdicts

The runtime chooses `{ versionNegotiation: { mode: "auto" } }` when no mode is explicitly set.
This lets the official SDK negotiate modern MCP v2 and conservatively fall back to legacy MCP.

After connection, read a persistable verdict with `getPriorDiscovery`:

```ts
await runtime.connect("knowledge");
const prior = runtime.getPriorDiscovery("knowledge");
await discoveryStore.set(authSubject, "knowledge", prior);
```

Supply it on a later runtime definition or with `setPriorDiscovery`:

```ts
runtime.setPriorDiscovery("knowledge", await discoveryStore.get(authSubject, "knowledge"));
await runtime.connect("knowledge");
```

Prior verdicts are never reused automatically. Scope them to the same authorization context and
apply your own freshness policy. A stale legacy verdict can silently keep selecting legacy after a
server upgrade. A stale modern verdict fails loudly if it is no longer compatible.

For a deliberate legacy-only connection:

```ts
{
	name: "legacy",
	transport: { kind: "http", url: "https://legacy.example.com/mcp" },
	clientOptions: { versionNegotiation: { mode: "legacy" } },
}
```

## Main API

- Registry: `register`, `unregister`, `has`, `names`, `getDefinition`
- Lifecycle: `connect`, `connectAll`, `disconnect`, `disconnectAll`, `close`, `Symbol.asyncDispose`
- SDK access: `getClient`, `requireClient`
- Discovery: `discover`, `getPriorDiscovery`, `setPriorDiscovery`
- General protocol: `ping`, `request`, `requestWithSchema`, `requestWithInputRequired`,
  `resumeInputRequired`, `notification`, `complete`
- Tools: `listTools`, `callTool`
- Resources: `listResources`, `listResourceTemplates`, `readResource`, `subscribeResource`,
  `unsubscribeResource`
- Prompts: `listPrompts`, `getPrompt`
- Modern subscriptions: `listen`, `activeSubscriptions`, `getAutoOpenedSubscription`
- Deprecated compatibility: `setLoggingLevel`, `sendRootsListChanged`
- Introspection: `snapshot(name?)`
- Transports: `createMcpHttpClientTransport`, `createMcpStdioClientTransport`,
  `createMcpClientTransport`, `createDefaultMcpClientTransportFactory`
- Fetch middleware: `composeMcpFetchMiddleware` plus re-exported `applyMiddlewares`,
  `createMiddleware`, `withLogging`, and `withOAuth`
- Official SDK facade: `Client`, `StreamableHTTPClientTransport`, `StdioClientTransport`, OAuth
  providers, discovery helpers, transport/client option types, and auth error classes

## Security notes

- Never share private SDK response-cache stores or prior discovery verdicts across principals.
- Avoid logging authorization headers or sensitive MCP inputs and outputs.
- Treat stdio command, arguments, working directory, and environment as privileged configuration.
- Prefer an explicit environment allowlist for spawned servers.
- Keep authorization policy in operation middleware even when transport authentication succeeds;
  authentication and authorization solve different problems.
