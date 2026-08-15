import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: [
			{
				find: /^@nestm\/mcp-server\/auth$/,
				replacement: new URL("../mcp-server/src/auth/index.ts", import.meta.url).pathname,
			},
			{
				find: /^@nestm\/mcp-server\/security$/,
				replacement: new URL("../mcp-server/src/security/index.ts", import.meta.url).pathname,
			},
			{
				find: /^@nestm\/mcp-server$/,
				replacement: new URL("../mcp-server/src/index.ts", import.meta.url).pathname,
			},
			{
				find: /^@nestm\/mcp-core$/,
				replacement: new URL("../mcp-core/src/index.ts", import.meta.url).pathname,
			},
		],
	},
	test: {
		include: ["tests/**/*.spec.ts", "tests/**/*.test.ts"],
	},
});
