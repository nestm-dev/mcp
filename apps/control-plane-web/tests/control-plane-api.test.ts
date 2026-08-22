import { afterEach, describe, expect, it, vi } from "vitest";

import {
  catalogSchema,
  connectionAuthenticationInputSchema,
  connectionSchema,
  connectionUpdateSchema,
  ControlPlaneApiError,
  controlPlaneApi,
  hubSchema,
  metricsSnapshotSchema,
  oauthAuthorizationPath,
  runtimeManagerSchema,
  toolCallResultSchema,
} from "../lib/control-plane-api";

const runtime = {
  phase: "online" as const,
  lastTransitionAt: "2026-08-21T12:00:00.000Z",
  protocolVersion: "2025-11-25",
  protocolEra: "modern",
  connectedAt: "2026-08-21T12:00:00.000Z",
  capabilities: {
    tools: true,
    resources: true,
    prompts: true,
    completion: false,
    subscriptions: false,
  },
};

const connection = {
  id: "3d9be1bd-faaa-45c8-8ba0-e7e747f19c71",
  revision: 1,
  runtimeGeneration: 1,
  displayName: "Docs",
  desiredState: "online" as const,
  deletionPending: false,
  createdAt: "2026-08-21T12:00:00.000Z",
  updatedAt: "2026-08-21T12:00:00.000Z",
  transport: { kind: "http" as const, host: "127.0.0.1:3200" },
  authentication: { kind: "none" as const, configured: true as const },
  runtime,
};

const metricsSnapshot = {
  scope: "process" as const,
  startedAt: "2026-08-21T11:55:00.000Z",
  capturedAt: "2026-08-21T12:05:00.000Z",
  totals: {
    started: 4,
    active: 1,
    outcomes: { success: 2, error: 1, cancelled: 0 },
    duration: { count: 3, averageMs: 15, p50Ms: 10, p95Ms: 25, maxMs: 30 },
  },
  window: {
    bucketSeconds: 10,
    buckets: [
      {
        startedAt: "2026-08-21T12:04:50.000Z",
        started: 2,
        outcomes: { success: 1, error: 1, cancelled: 0 },
        duration: { count: 2, averageMs: 18, p50Ms: 12, p95Ms: 24, maxMs: 30 },
      },
    ],
  },
  operations: [
    {
      role: "client" as const,
      name: "tools/call",
      kind: "request" as const,
      capability: "tools",
      started: 4,
      active: 1,
      outcomes: { success: 2, error: 1, cancelled: 0 },
      duration: { count: 3, averageMs: 15, p50Ms: 10, p95Ms: 25, maxMs: 30 },
    },
  ],
  operationsTruncated: false,
};

const hub = {
  revision: 3,
  updatedAt: "2026-08-21T12:06:00.000Z",
  endpoint: { transport: "streamable-http" as const, path: "/mcp/hub" as const },
  members: [
    {
      connectionId: connection.id,
      connectionRevision: connection.revision,
      runtimeGeneration: connection.runtimeGeneration,
      namespace: "docs",
      displayName: connection.displayName,
      attachedAt: "2026-08-21T12:05:00.000Z",
      runtime: { phase: "online" as const },
    },
  ],
  counts: { tools: 1, resources: 1, resourceTemplates: 1, prompts: 1 },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("control-plane response schemas", () => {
  it("accepts the complete connection projection and rejects additive envelope fields", () => {
    expect(connectionSchema.parse(connection)).toEqual(connection);
    expect(() =>
      connectionSchema.parse({ ...connection, endpoint: "http://private/mcp" }),
    ).toThrow();
  });

  it("accepts only redacted OAuth connection status", () => {
    const oauthConnection = {
      ...connection,
      authentication: {
        kind: "oauth",
        status: "authorized",
        authorizationServerHost: "testmcp-905604195.zohomcp.com",
        scopes: ["ZohoProjects.bugs.READ", "ZohoMCP.tool.execute"],
      },
    };

    expect(connectionSchema.parse(oauthConnection)).toEqual(oauthConnection);
    for (const leaked of [
      { accessToken: "secret" },
      { refreshToken: "secret" },
      { clientId: "public-but-not-needed" },
      { authorizationUrl: "https://authorization.invalid" },
    ]) {
      expect(() =>
        connectionSchema.parse({
          ...oauthConnection,
          authentication: { ...oauthConnection.authentication, ...leaked },
        }),
      ).toThrow();
    }
  });

  it("accepts only the neutral create authentication selector", () => {
    expect(connectionAuthenticationInputSchema.parse({ kind: "none" })).toEqual({ kind: "none" });
    expect(connectionAuthenticationInputSchema.parse({ kind: "oauth" })).toEqual({
      kind: "oauth",
    });
    expect(() =>
      connectionAuthenticationInputSchema.parse({ kind: "oauth", accessToken: "secret" }),
    ).toThrow();
  });

  it("keeps the catalog envelope strict while allowing additive MCP item fields", () => {
    const catalog = {
      connectionId: connection.id,
      runtimeGeneration: 1,
      discoveredAt: "2026-08-21T12:01:00.000Z",
      tools: [
        {
          name: "search",
          inputSchema: { type: "object", properties: { query: { type: "string" } } },
          futureSdkField: { supported: true },
        },
      ],
      resources: [],
      resourceTemplates: [],
      prompts: [],
    };

    expect(catalogSchema.parse(catalog).tools[0]).toMatchObject({ name: "search" });
    expect(() => catalogSchema.parse({ ...catalog, nextCursor: "unexpected" })).toThrow();
  });

  it("keeps hub envelopes strict and exposes only the pinned live-generation projection", () => {
    expect(hubSchema.parse(hub)).toEqual(hub);
    expect(() => hubSchema.parse({ ...hub, storage: "sqlite" })).toThrow();
    expect(() =>
      hubSchema.parse({
        ...hub,
        members: [{ ...hub.members[0], endpoint: "http://private/mcp" }],
      }),
    ).toThrow();
    expect(() =>
      hubSchema.parse({
        ...hub,
        members: [hub.members[0], { ...hub.members[0], connectionId: crypto.randomUUID() }],
      }),
    ).toThrow();
    expect(() =>
      hubSchema.parse({ ...hub, endpoint: { ...hub.endpoint, path: "/mcp" } }),
    ).toThrow();
  });

  it("rejects incomplete aggregate runtime snapshots", () => {
    expect(() =>
      runtimeManagerSchema.parse({
        closed: false,
        maxConnections: 8,
        connectionCount: 1,
      }),
    ).toThrow();
  });

  it("accepts a strict, internally consistent process metrics snapshot", () => {
    expect(metricsSnapshotSchema.parse(metricsSnapshot)).toEqual(metricsSnapshot);
    expect(() =>
      metricsSnapshotSchema.parse({ ...metricsSnapshot, rawMeasurements: [] }),
    ).toThrow();
    expect(() =>
      metricsSnapshotSchema.parse({
        ...metricsSnapshot,
        operations: [{ ...metricsSnapshot.operations[0], target: "generated-runtime-id" }],
      }),
    ).toThrow();
  });

  it("rejects contradictory metrics counts and invalid duration summaries", () => {
    expect(() =>
      metricsSnapshotSchema.parse({
        ...metricsSnapshot,
        totals: { ...metricsSnapshot.totals, started: 3 },
      }),
    ).toThrow();
    expect(() =>
      metricsSnapshotSchema.parse({
        ...metricsSnapshot,
        totals: {
          ...metricsSnapshot.totals,
          duration: { ...metricsSnapshot.totals.duration, p95Ms: 35 },
        },
      }),
    ).toThrow();
    expect(() =>
      metricsSnapshotSchema.parse({
        ...metricsSnapshot,
        totals: { ...metricsSnapshot.totals, active: Number.POSITIVE_INFINITY },
      }),
    ).toThrow();
  });

  it("bounds and chronologically validates metrics buckets", () => {
    const emptyBucket = {
      started: 0,
      outcomes: { success: 0, error: 0, cancelled: 0 },
      duration: { count: 0, averageMs: null, p50Ms: null, p95Ms: null, maxMs: null },
    };
    expect(() =>
      metricsSnapshotSchema.parse({
        ...metricsSnapshot,
        window: {
          bucketSeconds: 10,
          buckets: [
            { ...emptyBucket, startedAt: "2026-08-21T12:04:50.000Z" },
            { ...emptyBucket, startedAt: "2026-08-21T12:04:40.000Z" },
          ],
        },
      }),
    ).toThrow();
    expect(() =>
      metricsSnapshotSchema.parse({
        ...metricsSnapshot,
        window: {
          bucketSeconds: 10,
          buckets: Array.from({ length: 61 }, (_, index) => ({
            ...emptyBucket,
            startedAt: new Date(
              Date.parse("2026-08-21T12:00:00.000Z") + index * 1_000,
            ).toISOString(),
          })),
        },
      }),
    ).toThrow();
    expect(() =>
      metricsSnapshotSchema.parse({
        ...metricsSnapshot,
        startedAt: "not-a-date",
      }),
    ).toThrow();
    expect(() =>
      metricsSnapshotSchema.parse({
        ...metricsSnapshot,
        capturedAt: "2026-08-21T11:54:59.000Z",
      }),
    ).toThrow();
  });

  it("bounds and uniquely identifies operation metric groups", () => {
    expect(() =>
      metricsSnapshotSchema.parse({
        ...metricsSnapshot,
        operations: Array.from({ length: 101 }, (_, index) => ({
          ...metricsSnapshot.operations[0],
          name: `tools/call-${String(index)}`,
        })),
      }),
    ).toThrow();
    expect(() =>
      metricsSnapshotSchema.parse({
        ...metricsSnapshot,
        operations: [metricsSnapshot.operations[0], metricsSnapshot.operations[0]],
      }),
    ).toThrow();
  });

  it("allows a rename update to preserve the admitted endpoint", () => {
    expect(connectionUpdateSchema.parse({ displayName: "Renamed docs" })).toEqual({
      displayName: "Renamed docs",
    });
  });

  it("validates known tool content while preserving future MCP block types", () => {
    const result = {
      content: [
        { type: "text", text: "Answer", citations: [{ uri: "docs://answer" }] },
        {
          type: "chart",
          series: [{ label: "requests", values: [2, 5, 8] }],
        },
      ],
      structuredContent: { answer: 42 },
      isError: false,
      futureResultField: { supported: true },
    };

    expect(toolCallResultSchema.parse(result)).toEqual(result);
    expect(() =>
      toolCallResultSchema.parse({ content: [{ type: "text", value: "missing text" }] }),
    ).toThrow();
    expect(() => toolCallResultSchema.parse({ structuredContent: {} })).toThrow();
  });
});

describe("controlPlaneApi", () => {
  it("creates an OAuth connection with only its authentication kind", async () => {
    const oauthConnection = {
      ...connection,
      desiredState: "offline" as const,
      authentication: {
        kind: "oauth" as const,
        status: "authorization-required" as const,
      },
      runtime: { ...runtime, phase: "offline" as const },
    };
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(oauthConnection), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      controlPlaneApi.createConnection({
        displayName: "Zoho Projects",
        endpoint: "https://example.test/mcp",
        authentication: { kind: "oauth" },
        desiredState: "offline",
      }),
    ).resolves.toMatchObject({ authentication: { kind: "oauth" }, desiredState: "offline" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/mcp/connections",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          displayName: "Zoho Projects",
          endpoint: "https://example.test/mcp",
          authentication: { kind: "oauth" },
          desiredState: "offline",
        }),
      }),
    );
  });

  it("builds the revision-fenced same-origin OAuth authorization path", () => {
    expect(oauthAuthorizationPath(connection.id, 17)).toBe(
      `/api/v1/mcp/connections/${connection.id}/oauth/authorize?expectedRevision=17`,
    );
  });

  it("omits the endpoint when a rename preserves the current generation", async () => {
    const renamed = { ...connection, revision: 2, displayName: "Renamed docs" };
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(renamed), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      controlPlaneApi.replaceConnection(connection.id, 1, { displayName: "Renamed docs" }),
    ).resolves.toMatchObject({ displayName: "Renamed docs", runtimeGeneration: 1 });
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/mcp/connections/${connection.id}`,
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ expectedRevision: 1, displayName: "Renamed docs" }),
      }),
    );
  });

  it("uses the same-origin proxy and surfaces typed problem details", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            statusCode: 409,
            code: "MCP_REVISION_CONFLICT",
            message: "The expected revision is stale.",
          }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const request = controlPlaneApi.setDesiredState(connection.id, 1, "offline");
    await expect(request).rejects.toEqual(
      expect.objectContaining<Partial<ControlPlaneApiError>>({
        name: "ControlPlaneApiError",
        status: 409,
        code: "MCP_REVISION_CONFLICT",
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/mcp/connections/${connection.id}/desired-state`,
      expect.objectContaining({ method: "PUT", signal: expect.any(AbortSignal) }),
    );
  });

  it("loads a metrics snapshot through the same-origin proxy with cancellation", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(metricsSnapshot), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await expect(controlPlaneApi.metricsSnapshot(controller.signal)).resolves.toEqual(
      metricsSnapshot,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/mcp/metrics",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("uses the exact revision-fenced hub routes and bodies", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(hub), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ...hub, revision: 4 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ...hub, revision: 5 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await expect(controlPlaneApi.hubSnapshot(controller.signal)).resolves.toEqual(hub);
    await expect(
      controlPlaneApi.attachHubMember({
        connectionId: connection.id,
        namespace: "docs",
        expectedHubRevision: 3,
        expectedConnectionRevision: 1,
        runtimeGeneration: 1,
      }),
    ).resolves.toMatchObject({ revision: 4 });
    await expect(controlPlaneApi.detachHubMember(connection.id, 4, 1)).resolves.toBeUndefined();
    await expect(controlPlaneApi.refreshHubCatalog(4)).resolves.toMatchObject({ revision: 5 });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/v1/mcp/hub",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `/api/v1/mcp/hub/members/${connection.id}`,
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          namespace: "docs",
          expectedHubRevision: 3,
          expectedConnectionRevision: 1,
          runtimeGeneration: 1,
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      `/api/v1/mcp/hub/members/${connection.id}?expectedHubRevision=4&runtimeGeneration=1`,
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "/api/v1/mcp/hub/catalog/refresh",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ expectedHubRevision: 4 }),
      }),
    );
  });

  it("surfaces typed hub conflicts from an empty DELETE response path", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              statusCode: 409,
              code: "MCP_HUB_REVISION_CONFLICT",
              message: "The expected hub revision is stale.",
            }),
            { status: 409, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );

    await expect(controlPlaneApi.detachHubMember(connection.id, 2, 1)).rejects.toMatchObject({
      status: 409,
      code: "MCP_HUB_REVISION_CONFLICT",
    });
  });

  it("calls a tool through the same-origin API and decodes evolving content", async () => {
    const response = {
      content: [
        { type: "text", text: "React uses a virtual tree." },
        { type: "citation", uri: "https://deepwiki.com/facebook/react" },
      ],
      structuredContent: { repository: "facebook/react" },
    };
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(response), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      controlPlaneApi.callTool(connection.id, {
        name: "read_wiki_structure",
        arguments: { repoName: "facebook/react" },
      }),
    ).resolves.toEqual(response);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/mcp/connections/${connection.id}/tools/call`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          name: "read_wiki_structure",
          arguments: { repoName: "facebook/react" },
        }),
        signal: expect.any(AbortSignal),
      }),
    );
  });
});
