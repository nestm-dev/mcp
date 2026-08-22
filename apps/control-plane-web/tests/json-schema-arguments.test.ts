import { describe, expect, it } from "vitest";

import {
  RAW_ARGUMENTS_ERROR_PATH,
  ROOT_ARGUMENTS_ERROR_PATH,
  MAX_ARGUMENT_JSON_BYTES,
  analyzeArgumentSchema,
  argumentIncludedName,
  argumentModeName,
  argumentRawName,
  argumentValueName,
  createDefaultArguments,
  parseJsonSchemaArguments,
} from "../lib/json-schema-arguments";

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["query", "limit", "options"],
  properties: {
    query: {
      type: "string",
      description: "Search expression",
      minLength: 2,
      maxLength: 80,
    },
    limit: { type: "integer", minimum: 1, maximum: 20, default: 5 },
    exact: { type: "boolean", default: false },
    tags: {
      type: "array",
      items: { type: "string", minLength: 1 },
      minItems: 1,
    },
    options: {
      type: "object",
      required: ["strategy"],
      properties: {
        strategy: { type: "string", enum: ["fast", "thorough"] },
        threshold: { type: "number", minimum: 0, maximum: 1 },
      },
    },
  },
} as const;

function structuredData(): FormData {
  const data = new FormData();
  data.set(argumentModeName(), "fields");
  return data;
}

describe("analyzeArgumentSchema", () => {
  it("models supported nested object, scalar, enum, and array inputs", () => {
    const analysis = analyzeArgumentSchema(schema);

    expect(analysis.supported).toBe(true);
    if (!analysis.supported) return;
    expect(analysis.root.properties.map((property) => property.node.kind)).toEqual([
      "string",
      "integer",
      "boolean",
      "array",
      "object",
    ]);
    expect(analysis.root.properties[4]?.node).toMatchObject({
      path: "/options",
      required: true,
    });
  });

  it("falls back for ambiguous and unsupported schemas", () => {
    expect(analyzeArgumentSchema({ type: ["object", "null"] })).toEqual(
      expect.objectContaining({ supported: false }),
    );
    expect(
      analyzeArgumentSchema({
        type: "object",
        properties: { query: { oneOf: [{ type: "string" }, { type: "number" }] } },
      }),
    ).toEqual(
      expect.objectContaining({ supported: false, reason: expect.stringContaining("oneOf") }),
    );
  });

  it("collects nested defaults without inventing required values", () => {
    expect(createDefaultArguments(schema)).toEqual({ limit: 5, exact: false });
  });
});

describe("parseJsonSchemaArguments", () => {
  it("coerces structured form values without losing false or nested values", () => {
    const data = structuredData();
    data.set(argumentValueName("/query"), "react docs");
    data.set(argumentValueName("/limit"), "7");
    data.set(argumentIncludedName("/exact"), "true");
    data.set(argumentValueName("/exact"), "false");
    data.set(argumentIncludedName("/tags"), "true");
    data.set(argumentValueName("/tags"), '["ui", "mcp"]');
    data.set(argumentValueName("/options/strategy"), "fast");
    data.set(argumentIncludedName("/options/threshold"), "true");
    data.set(argumentValueName("/options/threshold"), "0.75");

    expect(parseJsonSchemaArguments(schema, data)).toEqual({
      success: true,
      mode: "fields",
      data: {
        query: "react docs",
        limit: 7,
        exact: false,
        tags: ["ui", "mcp"],
        options: { strategy: "fast", threshold: 0.75 },
      },
    });
  });

  it("omits optional fields unless their include control is selected", () => {
    const data = structuredData();
    data.set(argumentValueName("/query"), "mcp");
    data.set(argumentValueName("/limit"), "5");
    data.set(argumentValueName("/exact"), "true");
    data.set(argumentValueName("/tags"), '["ignored"]');
    data.set(argumentValueName("/options/strategy"), "thorough");

    expect(parseJsonSchemaArguments(schema, data)).toEqual({
      success: true,
      mode: "fields",
      data: { query: "mcp", limit: 5, options: { strategy: "thorough" } },
    });
  });

  it("returns errors keyed by JSON Pointer field paths", () => {
    const data = structuredData();
    data.set(argumentValueName("/query"), "x");
    data.set(argumentValueName("/limit"), "2.5");
    data.set(argumentValueName("/options/strategy"), "unknown");
    data.set(argumentIncludedName("/tags"), "true");
    data.set(argumentValueName("/tags"), '[""]');

    expect(parseJsonSchemaArguments(schema, data)).toEqual({
      success: false,
      mode: "fields",
      errors: expect.objectContaining({
        "/query": expect.stringContaining("at least 2"),
        "/limit": "Enter a whole number.",
        "/options/strategy": "Choose one of the advertised values.",
        "/tags": expect.stringContaining("/tags/0"),
      }),
    });
  });

  it("accepts raw JSON objects for unsupported schemas", () => {
    const unsupported = {
      type: "object",
      properties: { value: { anyOf: [{ type: "string" }, { type: "number" }] } },
    };
    const data = new FormData();
    data.set(argumentRawName(), '{"value": 42}');

    expect(parseJsonSchemaArguments(unsupported, data)).toEqual({
      success: true,
      mode: "raw",
      data: { value: 42 },
    });
  });

  it("rejects invalid raw JSON and non-object roots", () => {
    const invalid = new FormData();
    invalid.set(argumentModeName(), "raw");
    invalid.set(argumentRawName(), "{");
    expect(parseJsonSchemaArguments(schema, invalid)).toEqual({
      success: false,
      mode: "raw",
      errors: { [RAW_ARGUMENTS_ERROR_PATH]: "Enter valid JSON." },
    });

    const array = new FormData();
    array.set(argumentModeName(), "raw");
    array.set(argumentRawName(), "[]");
    expect(parseJsonSchemaArguments(schema, array)).toEqual({
      success: false,
      mode: "raw",
      errors: { [RAW_ARGUMENTS_ERROR_PATH]: "Tool arguments must be a JSON object." },
    });
  });

  it("bounds raw and generated argument payloads", () => {
    const oversized = "x".repeat(MAX_ARGUMENT_JSON_BYTES);
    const raw = new FormData();
    raw.set(argumentModeName(), "raw");
    raw.set(argumentRawName(), JSON.stringify({ value: oversized }));
    expect(parseJsonSchemaArguments(schema, raw)).toEqual({
      success: false,
      mode: "raw",
      errors: { [RAW_ARGUMENTS_ERROR_PATH]: expect.stringContaining("64 KiB") },
    });

    const generated = structuredData();
    generated.set(argumentValueName("/query"), oversized);
    generated.set(argumentValueName("/limit"), "5");
    generated.set(argumentValueName("/options/strategy"), "fast");
    const permissiveSchema = {
      type: "object",
      required: ["query"],
      properties: { query: { type: "string" } },
    };
    expect(parseJsonSchemaArguments(permissiveSchema, generated)).toEqual({
      success: false,
      mode: "fields",
      errors: { [ROOT_ARGUMENTS_ERROR_PATH]: expect.stringContaining("64 KiB") },
    });
  });

  it("validates supported schemas in raw mode", () => {
    const data = new FormData();
    data.set(argumentModeName(), "raw");
    data.set(
      argumentRawName(),
      JSON.stringify({ query: "ok", limit: 100, options: { strategy: "fast" } }),
    );

    expect(parseJsonSchemaArguments(schema, data)).toEqual({
      success: false,
      mode: "raw",
      errors: { [RAW_ARGUMENTS_ERROR_PATH]: "/limit: Enter a value no greater than 20." },
    });
  });

  it("preserves a '__proto__' argument as data without changing the result prototype", () => {
    const prototypeSchema = {
      type: "object",
      required: ["__proto__"],
      properties: { ["__proto__"]: { type: "string" } },
    };
    const data = structuredData();
    data.set(argumentValueName("/__proto__"), "safe");

    const result = parseJsonSchemaArguments(prototypeSchema, data);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(Object.getPrototypeOf(result.data)).toBe(Object.prototype);
    expect(Object.hasOwn(result.data, "__proto__")).toBe(true);
    expect(result.data["__proto__"]).toBe("safe");
  });
});
