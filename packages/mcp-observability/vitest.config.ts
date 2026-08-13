import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"@nestm/mcp-core": new URL("../mcp-core/src/index.ts", import.meta.url).pathname,
		},
	},
	test: {
		include: ["tests/**/*.test.ts"],
		coverage: {
			provider: "v8",
			include: ["src/**/*.ts"],
		},
	},
});
