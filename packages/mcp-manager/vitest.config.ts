import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: [
			{
				find: /^@nestm\/mcp-core$/,
				replacement: new URL("../mcp-core/src/index.ts", import.meta.url).pathname,
			},
			{
				find: /^@nestm\/mcp-client$/,
				replacement: new URL("../mcp-client/src/index.ts", import.meta.url).pathname,
			},
		],
	},
	test: {
		include: ["tests/**/*.test.ts", "tests/**/*.spec.ts"],
		testTimeout: 15_000,
		coverage: {
			provider: "v8",
			include: ["src/**/*.ts"],
		},
	},
});
