# @nestm/mcp-conformance

## 0.1.0-alpha.7

### Minor Changes

- eb921e7: Added bounded hostile-value capture and canonical catalog digests, so hosts stop hand-rolling both
  around the canonicalizer. `canonicalizeMcpConformanceValue` enforces only its own fixed ceilings and
  walks a hostile shape on the way there; `captureMcpConformanceValue(value, limits)` refuses the
  shape instead, copying an untrusted value into deep-frozen, null-prototype JSON data under
  caller-supplied bounds and rejecting proxies, accessor and non-enumerable properties, symbol keys,
  sparse or subclassed arrays, exotic prototypes, cycles, and non-finite numbers.
  `captureMcpToolArguments` layers a bounded argument record on it with predictive byte accounting
  that is cross-checked against the canonicalizer's exact output byte length. Bounds resolve through
  `resolveMcpConformanceCaptureLimits` against `MCP_CONFORMANCE_DEFAULT_CAPTURE_LIMITS` and
  `MCP_CONFORMANCE_HARD_CAPTURE_LIMITS`, and a refusal is an `McpConformanceCaptureError` carrying a
  structural `code` that never quotes the rejected value.

  `digestMcpRuntimeCatalog(snapshot, { domain, toolSchemaDomain, limits })` returns one
  `catalogFingerprint` plus a per-tool `schemaDigest` so a management path and a serving path can
  compare the same surface. The snapshot is typed structurally by its `tools`, `resources`,
  `resourceTemplates`, and `prompts` collections, keeping the kernel free of a runtime dependency.
  Discovery order never reaches a digest — each collection sorts on its identity with a canonical-form
  tiebreak — and a repeated identity is refused rather than silently collapsed. `fingerprintMcpConformanceValue`'s
  domain rule now also validates both caller-supplied digest domains, and the new
  `toMcpConformanceFingerprintHex` renders a `sha256:<base64url>` fingerprint as 64 lowercase
  hexadecimal characters for digest columns that check a fixed-width hexadecimal form.

- 4817eb0: Scoped the package to what it actually does and dropped the dead CI-regression half. The manifest
  description and keywords now state runtime integrity and safety probing for third-party MCP servers
  instead of conformance testing, and the README opens by disclaiming any relationship to the official
  `@modelcontextprotocol/conformance` spec-compliance suite: this kernel runs bounded, read-only
  probes against a server you do not control and supplies the canonicalization, bounded-capture, and
  catalog-fingerprinting primitives that detect catalog drift and refuse hostile payloads. It asserts
  nothing about the MCP specification.

  `compareMcpConformanceReports` and `toMcpConformanceJUnit` are removed with their types
  (`McpConformanceReportComparison`, `McpConformanceComparableReportComparison`,
  `McpConformanceIncomparableReportComparison`, `McpConformanceComparisonVerdict`,
  `McpConformanceCheckChange`), along with the now-unreachable `maxJunitBytes` entry in
  `MCP_CONFORMANCE_DEFAULT_LIMITS` and `MCP_CONFORMANCE_HARD_LIMITS`. Baseline-versus-candidate
  comparison and JUnit projection belong to a release pipeline, not to a runtime integrity kernel, and
  no caller in this repository used either. Plan execution, immutable reports, fingerprints, capture,
  catalog digests, and bounded JSON parsing and serialization are unchanged.

  `descriptor.subject` keeps its name — the control-plane API response contract and its web client
  both read it — and now carries a schema doc comment stating what it records: the build of the
  observing client that produced the report, never the observed target, which is `descriptor.target`.

## 0.1.0-alpha.6

## 0.1.0-alpha.5

### Minor Changes

- aba2981: Add a framework-neutral conformance runner with bounded immutable reports, explicit side-effect gating, semantic baseline comparison, stable fingerprints, and JSON/JUnit export.

## 0.1.0-alpha.4

### Minor Changes

- Add the initial framework-neutral conformance kernel with bounded sequential execution,
  immutable Zod/Standard Schema reports, explicit side-effect gating, stable fingerprints,
  semantic report comparison, non-blocking observers, bounded JSON import/export, and JSON/JUnit
  export.
