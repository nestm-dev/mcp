# NestM MCP control-plane validation API

This private NestJS application validates the public `@nestm/mcp-manager` runtime and
`@nestm/mcp/manager` Nest adapter as a consumer. It is deliberately outside `packages/*`: product
records, admission rules, status mapping, and persistence are not published as NestM behavior.

## Boundary

The application owns desired connection records, endpoint admission, catalog snapshots, HTTP
DTOs, and any future authentication material. The runtime supervisor receives only an opaque,
non-secret generation key and an admitted transport factory.

```text
HTTP controllers
  -> ConnectionControlService
  -> MCP_RUNTIME_SUPERVISOR application port
  -> McpManagerService / McpRuntimeManager<string>
  -> one McpClientRuntime per leased generation
```

The supervisor has no tenant, workspace, installation, user, credential, approval, or billing
types. Artifact Studio can later replace the in-memory connection repository and generation
resolver without changing the lifecycle contract.

`MCP_RUNTIME_SUPERVISOR` is the injectable application port. The reference module binds it to the
public Nest-owned `McpManagerService`; a product host can bind the same neutral manager port without
exposing lifecycle operations directly to a browser.

## Layer map

| Layer                        | This reference API                 | NestM packages                     | Artifact Studio later                           |
| ---------------------------- | ---------------------------------- | ---------------------------------- | ----------------------------------------------- |
| Desired connection authority | In-memory records and revision CAS | Opaque generation keys only        | Durable product records and approvals           |
| Admission                    | Exact-host HTTP policy             | Admitted transport definition      | Network, executable, and credential policy      |
| Runtime lifecycle            | Public Nest manager adapter        | `@nestm/mcp-manager`               | Invokes the manager through an application port |
| Catalog and execution        | Safe HTTP projections              | Typed MCP discovery and operations | Tenant-scoped evidence and authorization        |
| Aggregate inbound MCP hub    | Process-local membership + CAS     | Dynamic collision-safe gateway     | Product authorization around the same app port  |

This separation is intentional. The runtime manager is a process-local lifecycle component, not
a tenant or credential authority. Artifact Studio's durable control plane and outbound gateway stay
above it. The companion Inspector-style web console uses this API for lifecycle, discovery, and
explicit schema-aware tool calls. The northbound MCP hub is a separate composition whose
membership and policy stay application-owned.

## Process-local aggregate hub

The validation host exposes one always-present Streamable HTTP MCP endpoint at `/mcp/hub`.
Connections can be attached and detached without restarting the API:

- `GET /v1/mcp/hub`
- `PUT /v1/mcp/hub/members/:connectionId`
- `DELETE /v1/mcp/hub/members/:connectionId`
- `GET /v1/mcp/hub/catalog?expectedHubRevision=...`
- `POST /v1/mcp/hub/catalog/refresh`

Membership is in memory and resets when the API restarts. Each attachment receives a fresh opaque
routing identity while the application retains the human namespace. NestM's reversible gateway
codecs then produce unique tool names, prompt names, concrete resource URIs, and resource-template
URIs even when upstreams publish identical raw identifiers. Endpoint replacement, offline
transition, and deletion unpublish the member before retiring its managed runtime generation.

This reference endpoint is loopback-oriented and uses an allow-all gateway policy only after the
host's endpoint admission checks. Artifact Studio must replace that policy with its authenticated
authorization and durable authority; those concerns do not move into `@nestm/mcp-manager` or
`@nestm/mcp-gateway`.

## Safety posture

- The API binds to loopback only and fails configuration if a routable bind address is supplied.
- MCP HTTP endpoints require an exact host allowlist.
- Plain HTTP is accepted only for loopback endpoints when explicitly enabled.
- User info, query strings, fragments, cross-origin requests, and redirects are rejected.
- Stdio is intentionally absent: exposing command, environment, or working-directory input through
  this unauthenticated validation API would be remote code execution.
- Keep-online leases are anonymous in this reference. Credential-bearing Artifact generations
  should remain ephemeral until credential residency has its own reviewed contract.
- Responses never expose the stored endpoint path, runtime server name, session ID, upstream
  instructions, raw discovery result, or caught error message.
- Direct tool execution resolves the tool from the catalog captured for the current runtime
  generation, validates arguments before dispatch, and passes the pinned definition to the client
  runtime so advertised structured outputs are validated as well.
- This exact-host fetch guard demonstrates the admission seam; an internet-facing product still
  needs DNS pinning/rebinding protection, response-body limits, authentication, and rate limiting.

## Run

From the MCP workspace:

```sh
pnpm install
cp apps/control-plane-api/.env.example apps/control-plane-api/.env
pnpm --filter @nestm/mcp-control-plane-api run dev
```

The API listens on `http://127.0.0.1:3400`. Swagger is available at
`http://127.0.0.1:3400/docs`. The development command loads the ignored app-local `.env` file when
it exists; connection and OAuth state remain process-local and are still cleared on restart.

To admit a remote HTTPS server, add its exact resource hostname to `MCP_ALLOWED_HOSTS`. OAuth MCPs
also require every discovered authorization host in `MCP_OAUTH_ALLOWED_HOSTS`:

```dotenv
MCP_ALLOWED_HOSTS=127.0.0.1,localhost,::1,mcp.example.com
MCP_OAUTH_ALLOWED_HOSTS=127.0.0.1,localhost,::1,auth.example.com
```

## API

- `POST /v1/mcp/connections`
- `GET /v1/mcp/connections`
- `GET /v1/mcp/connections/:connectionId`
- `PUT /v1/mcp/connections/:connectionId`
- `DELETE /v1/mcp/connections/:connectionId?expectedRevision=...`
- `PUT /v1/mcp/connections/:connectionId/desired-state`
- `POST /v1/mcp/connections/:connectionId/probe`
- `GET /v1/mcp/connections/:connectionId/catalog`
- `POST /v1/mcp/connections/:connectionId/catalog/refresh`
- `POST /v1/mcp/connections/:connectionId/tools/call`
- `POST /v1/mcp/connections/:connectionId/resources/read`
- `POST /v1/mcp/connections/:connectionId/prompts/get`
- `GET /v1/mcp/runtime`
- `GET /v1/mcp/metrics`
- `GET /metrics`
- `GET /health/live`
- `GET /health/ready`

Connection mutations use integer revisions for compare-and-swap. Endpoint changes create a new
runtime generation. The repository switches authority first, then the old generation is fenced
and drained. Deletion keeps a fenced tombstone until drain succeeds; a failed close remains visible
and charged as quarantined capacity.

`PUT /v1/mcp/connections/:connectionId` always requires `displayName` and `expectedRevision`, but
its `endpoint` is optional. Omit it for a rename-only update that preserves the admitted endpoint
and runtime generation; provide it to replace and drain the generation without exposing the stored
endpoint path back to the browser.

## Volatile metrics

Metrics are intentionally process-local and reset whenever the API restarts. The JSON dashboard
snapshot keeps lifetime operation totals plus a fixed 15-minute window of 15-second buckets; the
Prometheus endpoint exposes the same aggregate counters and fixed latency histogram. Both omit
runtime targets, generation keys, connection IDs, endpoints, operation payloads, results, and raw
errors. No browser-side history or database persistence is used.

The connection repository and discovered catalogs are also in memory for this validation host.
Restarting the API clears them; durable product authority remains future Artifact Studio work.

## Remaining production work

This reference validates the published lifecycle seam rather than claiming to be a durable product
control plane. Before an Artifact Studio integration, add a durable desired-state adapter and
startup reconciliation, admitted credential factories, retry/backoff and circuit state, and
multi-process coordination. The aggregate hub now supports process-local live topology and
list-change invalidation; upstream notification bridging, subscription fan-out/backpressure,
multi-process topology, and product authorization remain production work.

Artifact should first put protected discovery and execution behind an Artifact-owned outbound MCP
gateway port. Its adapter must preserve pinned-tool/output validation and stricter byte, schema,
depth, cursor, and item bounds; final admission should mint only an opaque generation capability.
Connection, credential, release, and policy mutations then retire old generations through a durable
outbox/reconciler so a process crash cannot preserve stale authority.

## Verification

```sh
pnpm --filter @nestm/mcp-control-plane-api run typecheck
pnpm --filter @nestm/mcp-control-plane-api run test
pnpm run build
pnpm run verify:apps
```

The source tests run against NestM workspace barrels. `verify:apps` runs the built, externalized
consumer so Node must resolve the generated public package export maps and distribution files.
