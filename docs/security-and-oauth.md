# Security and OAuth

An MCP runtime gives callers access to executable capabilities. Authenticate transports, authorize every logical operation, constrain outbound connectivity, and assume tool metadata and results are untrusted content.

## Separate the roles

OAuth behavior is different on each side of the protocol:

| Runtime role | OAuth responsibility                                                                                                    |
| ------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Client       | Obtain, store, refresh, and attach a credential for a specific upstream resource                                        |
| Server       | Act as an OAuth resource server: publish protected-resource metadata, verify bearer tokens, and enforce required scopes |
| Gateway      | Authenticate the downstream caller as a resource server, then authenticate independently to each upstream as a client   |

The MCP server should not become a general Authorization Server. For new deployments, use a dedicated identity provider. The official v1 Authorization Server helpers remain only in the frozen legacy package.

## Client-side authentication

`@nestm/mcp-client` passes `authProvider` directly to the official Streamable HTTP transport. Supported provider shapes include:

- a simple bearer-token `AuthProvider` for credentials owned by another secret store;
- an interactive `OAuthClientProvider` with authorization redirect, PKCE verifier, registration, token, and discovery persistence;
- client credentials for service-to-service access;
- private-key JWT client authentication; and
- cross-application assertion exchange.

Client providers must:

- key registrations and credentials by authorization-server issuer;
- bind access-token requests to the protected resource through the RFC 8707 `resource` value when available;
- validate the published resource URL against the MCP destination;
- keep PKCE verifier and OAuth state confidential and single-use;
- validate redirect URIs exactly;
- encrypt durable tokens and client secrets at rest;
- coalesce concurrent refreshes and prevent refresh-token replay; and
- return a fresh transport after an interactive authorization hand-off when required by the SDK flow.

The transport may retry once after a `401` when the provider refreshes or completes authorization. Runtime middleware observes one logical call; fetch middleware observes each wire attempt.

Authentication failures are not protocol-era evidence. A `401` or `403` response to `server/discover` must remain an auth error and must not trigger a guess that the server is legacy.

## Server-side resource protection

`McpResourceServer` from `@nestm/mcp-server/auth` wraps a web-standard MCP handler as a resource
server:

1. Serve RFC 9728 protected-resource metadata and related authorization-server metadata.
2. Verify the bearer token before passing the request to the MCP handler.
3. Validate issuer, signature, expiry/not-before, audience/resource, and required scopes.
4. Pass the resulting `AuthInfo` into the official request context.
5. Project only token-free principal data into NestM operation context.

The safe principal includes OAuth client/scopes/resource metadata by default. When policy must
distinguish end users or tenants behind one client, a framework-neutral server can configure
`principalClaims(authInfo)`; a Nest server references a singleton provider whose
`resolvePrincipalClaims(authInfo)` method performs the same narrow projection. Project only
verified `subject` and `tenantId` strings. Never treat `clientId` as an end-user identity, and never
copy `AuthInfo.extra` wholesale into policy or telemetry context.

Missing, malformed, or expired tokens should return `401 invalid_token`. A valid token missing required scopes should return `403 insufficient_scope`. Both responses should include the correct `WWW-Authenticate: Bearer` challenge and protected-resource metadata URL so a compliant client can begin or step up its OAuth flow.

Do not rely on CORS, a session ID, a client-supplied identity header, or tool arguments as authentication.

## Authorization after authentication

Bearer verification answers “who presented an acceptable credential?” It does not answer “may this caller invoke this capability with these arguments?”

Use `McpAuthorizationPolicy` or the Nest handler policy to decide against:

- principal and tenant;
- runtime role and upstream server;
- method and capability family;
- tool/resource/prompt name;
- resource ownership and data classification;
- requested scopes and policy version; and
- gateway delegation mode.

NestM core enforcement fails closed once a policy is installed. A missing policy passed to the enforcement primitive, thrown policy, malformed decision, or explicit denial raises `McpAuthorizationError` before the terminal handler runs. The runtime cannot infer an application's domain policy, so protected deployments must install authorization explicitly. Keep lifecycle observation outside authorization middleware when denied attempts must be audited.

For expensive or side-effecting tools, authorization should happen both before dispatch and at the domain service that performs the mutation. Do not trust a gateway decision as the only protection on the target service.

### Nest validated handler authorization

For decorated Nest tools, resources, and prompts, configure `handlerAuthorization` with a singleton
provider token whose `authorize()` method implements the policy. The official SDK validates
arguments and resolves the registered callback first; the policy then receives a stable
`McpHandlerInvocationInput` containing the trusted handler kind, name, server name, source, and
validated callback arguments. Its operation context contains the official request method,
cancellation signal, transport kind, and a token-free principal projection for authenticated HTTP
requests.

The execution order is:

1. `handlerLifecycleObserver` starts the payload-free operation event.
2. `handlerAuthorization` makes the mandatory allow/deny decision.
3. `handlerMiddleware` applies application deadlines, concurrency, audit, and other policy.
4. The decorated provider callback runs.

Custom handler middleware cannot short-circuit around `handlerAuthorization`. The same callback pipeline runs for HTTP and stdio, so it is the correct per-tool/resource/prompt authorization seam. Stdio does not create an OAuth principal automatically; authenticate and isolate the process boundary or provide an application identity policy appropriate to that transport.

Catalog exposure runs only after the visibility wave has completed successfully. Search metadata
is opt-in, and lazy list/search or schema-fetch tools receive a frozen projection containing only
the tools visible in that build. Resolver and selector inputs omit handlers, visibility providers,
raw requests, bearer tokens, and provider-specific authentication data. Treat lazy discovery as a
usability optimization only: deferred tools and both lazy meta-tools still enter the ordinary
`handlerAuthorization` pipeline when called. Catalog mode rejects gateway composition and custom
Nest server contributors because those contributors have no public enumeration seam from which a
complete safe projection could be built.

Policies and handler middleware can inspect validated callback arguments because domain authorization may depend on ownership or requested action. Treat that input as sensitive: do not copy it into lifecycle attributes, metric labels, or ordinary logs.

Framework-neutral `McpServerDefinition.middleware` has a narrower purpose: it surrounds an HTTP
exchange before official MCP parsing and does not run for stdio. Nest server configuration accepts
injectable provider tokens for the same layer. Use it for coarse HTTP concerns, not as the sole
authorization boundary for a capability. Likewise, a separately mounted raw Node handler does not
automatically pass through Nest guards or interceptors.

Gateway transforms run after the gateway's mandatory call-time policy. Client transforms have no
implicit authorization policy because the client runtime cannot infer an application's outbound
authorization rules. Exact client transforms are partitioned downstream of every configured general
middleware, so an outbound authorization middleware always precedes them even if listed later.
General transforming middleware remains caller-ordered; place authorization before any such
middleware that may short-circuit. Neither transform layer substitutes for authorization on the
target server.

## Multi-round input and request state

Modern MCP `2026-07-28` represents interactive work with `input_required` results from
`tools/call`, `prompts/get`, or `resources/read`. The client fulfils the embedded requests and
retries the original operation with a fresh request ID. The deprecated 2025 `tasks/*` wire
vocabulary is not a modern background-job runtime and must not be used as the basis for new agent
orchestration.

Every retry is a new authorization event. Re-run capability policy and domain authorization on
each handler entry; an approval from an earlier round does not make the final mutation implicitly
authorized. `inputResponses` contains only the current round and comes from the caller. Validate
accepted form content with `acceptedContent(..., schema)` or branch through `inputResponse` before
using it. Use URL elicitation or an out-of-band flow for credentials, payment details, and other
sensitive input rather than embedding them in a form request.

Modern HTTP server instances are stateless between rounds. If the handler must carry proven facts
forward, place only the minimal non-secret claim in `requestState` and configure the official
`createRequestStateCodec` verifier. The state must have a short TTL and be bound to the originating
method plus the stable tenant and end-user authorization context. Include a signed digest of
immutable operation arguments when changing them would alter what the user approved. The codec is
HMAC integrity protection, not encryption; a client can read the payload. Never mint an approval
claim before validating the response that proves it.

Client auto-fulfilment must have a finite round limit and a whole-flow deadline. Manual mode must
echo server state byte-for-byte without interpreting it, send only responses for the current
round, and preserve cancellation through the official request funnel. A gateway cannot relay
multi-round work safely by exposing raw upstream state: it needs its own signed route envelope,
bound to the downstream caller and re-authorized on every retry.

## Gateway credential separation

A gateway has two independent security contexts:

- **downstream:** the caller's identity and permission to see or invoke a projected capability;
- **upstream:** the gateway's credential or a deliberately exchanged/delegated credential accepted by the selected server.

Safe default: never forward the downstream `Authorization` header to an upstream destination. Choose one strategy per upstream:

- gateway service identity with least-privilege scopes;
- user-delegated token obtained through an explicit token-exchange policy;
- user-owned upstream OAuth provider keyed by user, issuer, and resource; or
- no upstream credential for a public server.

Nest named-client gateway entries implement the service-identity strategy. For delegation, pass a
complete `{ name, client: resolver }` upstream in the server's gateway configuration. That resolver
receives the verified request context and should return a client partitioned by issuer, resource,
tenant, principal, and credential fingerprint. It must not reuse a user-specific client across
authorization contexts.

Record which strategy was selected without logging the credential. Capability discovery caches must be partitioned by any identity or scope that can change the advertised capability set.

Gateway URI namespacing is routing, not encryption. The default reversible codec rejects URI userinfo, but query strings and paths remain decodable by downstream callers. Never place access tokens, API keys, or other secrets in an MCP resource URI; use an application-owned keyed or registry-backed codec when upstream topology itself is confidential.

## Outbound HTTP and SSRF

The client transport accepts `http:` and `https:` URLs. A production registry should additionally:

- require HTTPS except for explicit local development;
- allowlist schemes, hosts, ports, and path prefixes;
- resolve and reject loopback, link-local, metadata-service, and private addresses unless explicitly approved;
- repeat destination checks after redirects and DNS resolution;
- disable or tightly bound redirects;
- apply connection, header, body, and total-operation timeouts;
- cap response sizes and concurrent calls; and
- use egress network policy as a second enforcement layer.

Do not accept an MCP server URL directly from a model-generated tool argument.

## Stdio process safety

Stdio transport starts a local command and treats stdout as the JSON-RPC wire. Therefore:

- command, arguments, working directory, and environment come only from trusted configuration;
- use an executable allowlist and preferably an absolute path;
- pass a minimal environment instead of inheriting secrets;
- run with a dedicated OS identity, filesystem sandbox, and resource limits;
- log to stderr only—any stdout logging corrupts the protocol; and
- bound shutdown and forcefully reap child processes that do not exit.

Never interpolate tool input into a shell command. Prefer direct executable/argument arrays over a shell.

## HTTP server hardening

- Terminate TLS at a trusted boundary and preserve the original scheme/host safely.
- Configure allowed hosts and origins when binding beyond loopback; defend against DNS rebinding.
- Set request-body and concurrency limits before MCP parsing.
- Rate limit by trusted principal and operation, not only IP address.
- Propagate abort signals and deadlines to tools and upstream calls.
- Return generic external errors while retaining structured internal audit context.
- Close handlers and registries during graceful shutdown.
- Use a distributed event bus when subscriptions span nodes; do not mistake an in-process bus for durable delivery.

## Agent and content risks

Authentication proves server identity only to the degree provided by TLS and configured trust. Tool descriptions, prompt templates, resource contents, and tool results can still contain prompt injection or malicious data.

An artifact/agent host should:

- expose only an allowlisted capability projection to each agent;
- display or log the selected server and operation for sensitive actions;
- require confirmation for destructive or high-impact operations;
- validate arguments and structured results against schemas;
- treat text results as data, not higher-priority instructions;
- isolate tenant and workspace paths; and
- keep model-visible errors free of secrets and internal topology.

## Secret and telemetry handling

Never include access tokens, refresh tokens, client secrets, authorization codes, PKCE verifiers, cookies, complete request bodies, or complete tool results in logs or lifecycle attributes. Hash or tokenize stable identifiers when correlation is required. Use low-cardinality policy and server identifiers for metrics.

NestM lifecycle events omit inputs and outputs, and server/gateway operation principals omit bearer tokens and arbitrary token metadata. `@nestm/mcp-observability` projects only bounded protocol fields by default; selecting application fields or raw exception recording is an explicit opt-in. Custom observers, telemetry hooks, and SDK fetch logging middleware must preserve those guarantees.

## Deployment checklist

- [ ] HTTPS and outbound destination allowlists are enforced.
- [ ] Every protected server publishes correct RFC 9728 metadata.
- [ ] Issuer, audience/resource, expiry, and scopes are verified.
- [ ] Logical operations have a fail-closed authorization policy.
- [ ] Decorated Nest capabilities use `handlerAuthorization`; HTTP-exchange middleware is not treated as a stdio policy.
- [ ] Gateway downstream and upstream credentials are separate.
- [ ] OAuth state is encrypted and keyed by issuer and resource.
- [ ] Stdio definitions are trusted, allowlisted, and sandboxed.
- [ ] Payloads and secrets are redacted from logs and traces.
- [ ] Timeouts, cancellation, concurrency, and size limits are configured.
- [ ] Destructive agent actions require an appropriate confirmation policy.
- [ ] Multi-round state is signed, short-lived, principal/method-bound, and contains no secrets.
- [ ] Shutdown closes inbound handlers before their gateway's upstream clients.

Relevant standards include [RFC 8414](https://www.rfc-editor.org/rfc/rfc8414), [RFC 8707](https://www.rfc-editor.org/rfc/rfc8707), [RFC 9728](https://www.rfc-editor.org/rfc/rfc9728), and PKCE in [RFC 7636](https://www.rfc-editor.org/rfc/rfc7636).
