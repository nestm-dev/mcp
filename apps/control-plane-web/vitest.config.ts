import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      "@nestm/mcp-ui-core": fileURLToPath(
        new URL("../../packages/mcp-ui-core/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
  },
});
