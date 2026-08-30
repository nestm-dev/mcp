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
- Zod v4 projection for dynamically discovered tool schemas, with Standard Schema compatibility

## Install

```sh
pnpm add @nestm/mcp-client@alpha @modelcontextprotocol/client@2
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

When a host dynamically composes discovered tools, convert the remote JSON Schema into a real Zod
v4 schema instead of asserting it into a package-local type:

```ts
import { createMcpClientToolSchema } from "@nestm/mcp-client";

const { tools } = await runtime.listTools("knowledge");
const inputSchema = createMcpClientToolSchema(tools[0]!.inputSchema);
const parsed = inputSchema.parse(candidateArguments);
```

Zod v4 implements Standard Schema and Standard JSON Schema, so the returned schema also works
directly with vendor-neutral consumers. The schema's Zod refinement delegates the validation
predicate to the official MCP validator. This retains every Draft 2020-12 constraint, does not
apply annotations such as `default` as transforms, and returns successful values unchanged. The
detached remote definition is preserved as immutable Zod metadata and through the Standard JSON
Schema hook. Explicit non-2020-12 declarations fail during construction, and the returned schema's
projection methods reject requests for another target instead of relabelling 2020-12 keywords.
Structured-output validation stays on the exact `McpClientRuntime.callTool()` path with the
discovered `toolDefinition`.

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

## Strict host-managed OAuth

Multi-tenant hosts should use the dedicated `@nestm/mcp-client/oauth` surface instead of allowing
the transport to start an interactive SDK flow. The strict facade only accepts clients that were
provisioned out of band. It has no Dynamic Client Registration operation, requires exact resource
and issuer bindings, requires PKCE S256 plus the RFC 9207 authorization-response issuer parameter,
and re-checks every discovered or credentialed endpoint through host policy.

```ts
import { McpClientOAuthProtocol } from "@nestm/mcp-client/oauth";

const oauth = new McpClientOAuthProtocol({
	// This must reject redirects, private/rebound addresses, oversized bodies, and timeouts.
	fetch: ssrfGuardedOAuthFetch,
	endpointPolicy({ endpoint, credentialed }) {
		if (endpoint.port !== "" && endpoint.port !== "443") return false;
		if (!allowedOAuthOrigins.has(endpoint.origin)) return false;
		return !credentialed || credentialOrigins.has(endpoint.origin);
	},
});

const authority = await oauth.discover({
	serverUrl: "https://mcp.example.com/mcp",
	resource: "https://mcp.example.com/mcp",
	issuer: "https://identity.example.com/",
});

const started = await oauth.startAuthorization({
	authority,
	client: { clientId, authentication: { method: "none" } },
	redirectUri: "https://studio.example.com/oauth/callback",
	scopes: ["mcp:tools"],
});

// Persist `started.transaction` with authenticated encryption and browser-session binding.
// The plaintext state exists only in `started.authorizationUrl`; the record keeps its digest.
await savePendingAuthorization(started.transaction);
redirectUser(started.authorizationUrl);
```

On callback, parse the parameters, derive the state lookup digest, and atomically take the pending
transaction before calling `exchangeAuthorization`. A consumed transaction stays consumed even
when token exchange has an ambiguous network result. The facade validates state lifetime, callback
issuer, client identity, and the authority/endpoints pinned before redirect; callbacks without the
exact RFC 9207 `iss` value fail closed, and the facade never rediscovers an endpoint while redeeming
a code.

The subpath also provides a revisioned credential-store port and
`McpClientOAuthRefreshCoordinator`. Refreshes for one opaque identity and exact revision share one
operation. Before dispatch, the store must atomically claim the exact revision with a durable
fencing token; another process observing that claim never sends the same refresh token. A rotated
refresh token is committed only by that claim owner. Retry-safe pre-dispatch failure can release the
claim explicitly, while an abandoned or indeterminate post-dispatch claim must become terminal and
must never reactivate the old generation. If the outcome becomes unknowable after a refresh request
may have reached the authorization server, the old generation is invalidated instead of replayed.
Terminal invalidation or an observed external disappearance can evict credential-bound client
leases. Successful rotation and a newer winner remain within the same stable binding and do not
invoke the terminal invalidation hook. Identity keys must be non-secret and include every immutable
host isolation coordinate. The coordinator awaits its invalidation hook while the failed request
may still hold that same lease, so a lease-eviction hook must initiate retirement and return without
awaiting active-lease drain; observe and report the eventual drain separately.

Create one `McpClientOAuthAuthProvider` per credential binding and close it with that binding's
runtime lease. The bridge implements only the SDK's minimal `AuthProvider`: it loads the current
generation before each request and delegates a `401` refresh to the coordinator, but has no
`OAuthClientProvider` methods that could trigger redirects or registration. Set the HTTP transport's
`options.onInsufficientScope` to `"throw"` so scope escalation returns to host policy instead of
starting an implicit interactive flow. The bridge follows successful token revisions inside one
stable owner/authority binding. A host that treats every token revision as a new runtime identity
must close or reacquire that runtime after the operation instead of pooling it under the old
revision.

The SDK's minimal `onUnauthorized` callback does not report which token revision was attached to
the failed request. On a concurrent or long-lived transport, a delayed `401` can therefore arrive
after another request has published a newer generation. Use close-on-release/no credentialed
pooling for this bridge, or perform request-correlated refresh at a host fetch boundary; do not
claim exact 401-to-revision attribution from the minimal provider alone.

When the bridge is admitted through `McpRuntimeManager`, the ordinary `ensureOnline()` keeper is a
pool and does not meet that close-on-release condition. Use the manager operation option
`{ leaseMode: "exclusive" }` without retaining the generation: it rejects overlapping work for the
same key and closes the dedicated runtime plus admitted material before settlement. Shared manager
generations remain appropriate only when the host provides the request-correlated refresh boundary
and exact revision fence described above. Manager-owned exclusive catalog refreshes serialize their
protocol requests; a custom exclusive `withClientRuntime` callback must also avoid parallel
credentialed requests when it relies on this no-concurrency guarantee.

Encryption, AAD construction, owner/scope authorization, RLS, callback-session checks, and the
atomic pending-transaction store remain application responsibilities. OAuth fetches should use a
separate guarded path from arbitrary MCP middleware: request logging or middleware that can inspect
headers and form bodies can expose bearer tokens, client secrets, codes, or refresh tokens. Treat
returned `id_token` values as opaque unless a separate OIDC validator verifies them. The guarded
fetch must never automatically retry a credentialed token `POST`; one durable refresh claim permits
at most one wire exchange, and an ambiguous result must return to the coordinator unchanged.

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
				stderr: "inherit",
			},
		},
	],
});

await runtime.connect("local-files");
```

The default factory returns the official `StdioClientTransport` class exactly. That matters for
the SDK's v2 automatic negotiation path, which can probe stdio through a short-lived sibling
process before opening the session process.

Prefer `stderr: "inherit"` or `"ignore"` for a noisy child. The runtime does not expose an owned
stdio transport before the handshake, so an unread `"pipe"` can fill and block the child. To capture
stderr, provide a custom transport factory that attaches a reader before returning the transport.

The built-in transport definitions cover Streamable HTTP and stdio. A standalone legacy SSE-only
endpoint is not automatically detected or exposed as a first-class transport. OAuth transport
authentication applies to HTTP; stdio credentials are an out-of-band concern for the spawned
process and should be passed only through explicitly controlled configuration.

## Opt-in external smoke test

The repository's default test and verification commands never contact external services. To check
the built package against a real Streamable HTTP or stdio server, run the package-local smoke
command with environment-only configuration:

```sh
export MCP_SMOKE_TRANSPORT=http
export MCP_SMOKE_URL=https://mcp.example.com/mcp
export MCP_SMOKE_AUTH=bearer
export MCP_SMOKE_BEARER_TOKEN="$(read-token-from-your-secret-store)"
pnpm --filter @nestm/mcp-client smoke:external
```

Machine-to-machine OAuth uses the official client-credentials provider and requires issuer
binding:

```sh
export MCP_SMOKE_AUTH=oauth-client-credentials
export MCP_SMOKE_OAUTH_CLIENT_ID=smoke-client
export MCP_SMOKE_OAUTH_CLIENT_SECRET="$(read-secret-from-your-secret-store)"
export MCP_SMOKE_OAUTH_EXPECTED_ISSUER=https://identity.example.com
export MCP_SMOKE_OAUTH_SCOPE="mcp:tools mcp:resources"
pnpm --filter @nestm/mcp-client smoke:external
```

For stdio, arguments are a JSON string array and only explicitly named environment variables are
forwarded in addition to the official SDK's safe default environment:

```sh
export MCP_SMOKE_TRANSPORT=stdio
export MCP_SMOKE_COMMAND=node
export MCP_SMOKE_ARGS_JSON='["./dist/server.mjs"]'
export MCP_SMOKE_STDIO_ENV_NAMES=MCP_SERVER_TOKEN
export MCP_SERVER_TOKEN="$(read-token-from-your-secret-store)"
pnpm --filter @nestm/mcp-client smoke:external
```

The command connects, calls `server/discover` on the modern session transport, uses legacy `ping`
only when that method is valid for the negotiated era, lists advertised tools/resources/prompts,
and emits only counts and protocol metadata. Set `MCP_SMOKE_TOOL_NAME` and
`MCP_SMOKE_TOOL_ARGUMENTS_JSON` to opt into a real tool call; its result is not printed and all
nested scalar argument values are treated as secrets in harness diagnostics. `MCP_SMOKE_PROTOCOL`
accepts `auto` (default), `legacy`, or a valid modern calendar date on or after `2026-07-28` to pin.
Additional HTTP headers can be supplied through `MCP_SMOKE_HTTP_HEADERS_JSON`; their values are
also treated as secrets in diagnostics.

`MCP_SMOKE_TIMEOUT_MS` bounds the active phase starting before any development build and covering
the MCP requests. On timeout, an active development build is terminated and
in-flight MCP work is aborted. Runtime teardown then has a separate shutdown bound of the same
duration, so cleanup can extend total elapsed time. Stdio stderr defaults to `ignore`. Setting
`MCP_SMOKE_STDIO_STDERR=inherit` sends the child output directly to the terminal, outside the
harness redactor; use it only with a trusted server that does not log credentials or payloads.

The command refuses to run when `CI` is set unless `MCP_SMOKE_ALLOW_CI=true` is also set, and it is
not referenced by the normal CI workflow. Use that override only in a trusted, explicitly
configured job backed by a secret store. Interactive browser OAuth is intentionally not automated
here; use a short-lived bearer token obtained by the host flow, while the hermetic interoperability
suite covers authorization-code, PKCE, state, issuer, and reconnect behavior.

Run `node packages/mcp-client/scripts/external-smoke.mjs --help` for every supported variable.

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

## Identity-isolated client leases

Hosts that create separate client runtimes for different credential or authorization contexts can
use `McpClientLeaseManager`. Its identity key is opaque: the manager uses `Map` equality and passes
the key only to the host factory. Use a canonical, non-secret identifier that changes whenever any
credential, allowed capability, upstream configuration, or other isolation-relevant input changes.
Never place an access token, refresh token, authorization code, or other secret in the key.

```ts
import { McpClientLeaseManager, McpClientRuntime } from "@nestm/mcp-client";

const clients = new McpClientLeaseManager({
	maxResources: 64,
	idleTtlMs: 30_000,
	async create(identityKey: string, { signal }) {
		const definition = await loadServerDefinition(identityKey, { signal });
		const runtime = new McpClientRuntime({ servers: [definition] });
		await runtime.connect(definition.name, { signal });
		return { runtime, serverName: definition.name };
	},
	async close(resource) {
		await resource.runtime.close();
	},
});

const lease = await clients.acquire(identityKey); // defaults to releaseMode: "close"
try {
	await lease.resource.runtime.listTools(lease.resource.serverName);
} finally {
	await lease.release(); // idempotent; closes after the final reference
}
```

Concurrent acquisitions for one key share one in-flight factory and maintain independent
references. An existing generation pins its release mode and rejects a conflicting acquisition.
The default `"close"` mode is intended for credential-bound resources. Only resources that are
safe to retain and reuse should opt into `{ releaseMode: "idle" }`; they remain cached until
`idleTtlMs` expires and may be evicted earlier to admit another identity within `maxResources`.

`invalidate(identityKey)` retires the matching generation before awaiting its close. It aborts a
pending factory and prevents a late result from publishing, even if a replacement generation has
already started. Active leases drain before their resource closes, so callers must release every
accepted lease. `close()` and `Symbol.asyncDispose` reject new acquisitions, abort all factories,
drain active leases, and settle all resource closes. The manager cannot forcibly stop a factory
that ignores its abort signal, so factories must honor cancellation. Snapshots are aggregate-only,
and manager-created errors never include identity keys or resources.

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

The method-keyed `request()` and high-level `callTool()`, `getPrompt()`, and `readResource()`
helpers likewise expose `InputRequiredResult` in their return type for an MRTR-capable method when
`allowInputRequired: true` is explicit. With the default or an explicit `false`, their
complete-result type remains narrow.

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
import {
	McpClientRuntime,
	createMcpClientPassthroughMiddleware,
	defineMcpClientTransform,
} from "@nestm/mcp-client";

const observer: McpLifecycleObserver = {
	onEvent(event) {
		telemetry.record(event);
	},
};

const runtime = new McpClientRuntime({
	servers,
	principal: currentPrincipal,
	attributes: { deployment: "artifact-runtime" },
	middleware: [
		createMcpAuthorizationMiddleware(policy),
		createMcpClientPassthroughMiddleware(async (operation, next) => {
			metrics.started(operation.input.method);
			await next();
			metrics.finished(operation.input.method);
		}),
		defineMcpClientTransform("tools/call", async (operation, next) => {
			const result = await next(); // CallToolResult, without a cast
			return { ...result, _meta: { ...result._meta, auditedTool: operation.input.params.name } };
		}),
	],
	observer,
});
```

Middleware sees a stable `McpClientOperationInput` and context fields including `role: "client"`,
the protocol method, capability family, target server name, abort signal, session ID when known,
principal, and host attributes. Lifecycle observer failures are best-effort and do not replace the
operation result.

`createMcpClientPassthroughMiddleware` is the safer default for non-transforming concerns. Its
callback cannot inspect or replace the method-specific result; the runtime returns the exact value
produced downstream. `defineMcpClientTransform(method, transform)` is the deliberate transforming
path: its callback receives only that official method's request and `ResultTypeMap` result.

The runtime dispatches this helper only for operations whose public result is exactly the ordinary
official result. Custom-schema requests, manual MRTR/input-required calls, MRTR-capable calls with
`allowInputRequired: true`, and the runtime-managed high-level `listen()` handle are excluded even
when their method string matches. Request options are snapshotted and frozen before dispatch while
callback, signal, and deadline values retain their identities; a supplied tool definition is
detached and deeply frozen. Official requests and params are likewise detached and deeply frozen.
The policy, transform, and SDK terminal therefore observe the same method, arguments, and
result-affecting controls even if a caller later mutates its objects. Abort checks also surround
the transform, lifecycle observation stays outside it, and the shared `next()` continuation
remains callable once.

The runtime places exact transforms downstream of all general middleware, preserving relative
order within each group. A configured authorization middleware therefore always runs before an
exact transform, even if the transform appears first in the options array, and an exact `next()`
cannot receive an unrelated result returned by general middleware.

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
  `createMcpClientTransport`, `defaultMcpClientTransportFactory`
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
