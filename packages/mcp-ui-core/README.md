# @nestm/mcp-ui-core

Browser-safe, headless UI models shared by MCP management surfaces. The package analyzes a
conservative JSON Schema subset into immutable tool-argument field nodes, parses matching
`FormData`, validates raw or structured submissions, creates default values, and formats JSON for
presentation.

```sh
pnpm add @nestm/mcp-ui-core@alpha
```

```ts
import {
	analyzeArgumentSchema,
	createDefaultArguments,
	parseJsonSchemaArguments,
} from "@nestm/mcp-ui-core";

const analysis = analyzeArgumentSchema(tool.inputSchema);
const defaults = createDefaultArguments(tool.inputSchema);
const parsed = parseJsonSchemaArguments(tool.inputSchema, formData);
```

## Boundary

This is a headless interaction model, not a renderer and not a security boundary. It contains no
React, DOM-node manipulation, CSS, component library, editor, network, persistence, or application
API code. Hosts own rendering, accessibility, styling, mutation confirmation, server-side schema
validation, authorization, and dispatch. Browser consumers supply the web-standard `FormData`;
the implementation also uses `TextEncoder` and WHATWG `URL`.

The argument model is deliberately MCP-tool-specific and opinionated rather than a general JSON
Schema implementation:

- the root must be an object;
- nested objects, scalar fields, enums, arrays, defaults, and common string formats receive typed
  field nodes;
- ambiguous or unsupported child schemas become field-local JSON nodes, while an unsupported root
  uses raw JSON mode;
- argument objects are limited to 64 KiB;
- generated names default to the `tool-arguments` form prefix; and
- JSON Schema remains authoritative only on the server. Browser parsing is an interaction aid.

Rendering and editor integrations intentionally remain in the consuming application. Do not add
React, CodeMirror, Tailwind, shadcn, control-plane API contracts, or product state to this package.

Use the root export or the focused `@nestm/mcp-ui-core/json-schema-arguments` and
`@nestm/mcp-ui-core/json-document` subpaths.
