import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: [
			{
				find: /^@nestm\/mcp-manager$/,
				replacement: new URL("../mcp-manager/src/index.ts", import.meta.url).pathname,
			},
			{
				find: /^@nestm\/mcp-server\/auth$/,
				replacement: new URL("../mcp-server/src/auth/index.ts", import.meta.url).pathname,
			},
			{
				find: /^@nestm\/mcp-server\/security$/,
				replacement: new URL("../mcp-server/src/security/index.ts", import.meta.url).pathname,
			},
			{
				find: /^@nestm\/mcp-server\/testing$/,
				replacement: new URL("../mcp-server/src/testing/index.ts", import.meta.url).pathname,
			},
			{
				find: /^@nestm\/mcp-auth\/testing$/,
				replacement: new URL("../mcp-auth/src/testing/index.ts", import.meta.url).pathname,
			},
			{
				find: /^@nestm\/mcp-auth\/cimd$/,
				replacement: new URL("../mcp-auth/src/cimd/index.ts", import.meta.url).pathname,
			},
			{
				find: /^@nestm\/mcp-auth\/stores$/,
				replacement: new URL("../mcp-auth/src/stores/index.ts", import.meta.url).pathname,
			},
			{
				find: /^@nestm\/mcp-auth$/,
				replacement: new URL("../mcp-auth/src/index.ts", import.meta.url).pathname,
			},
			{
				find: /^@nestm\/mcp-client$/,
				replacement: new URL("../mcp-client/src/index.ts", import.meta.url).pathname,
			},
			{
				find: /^@nestm\/mcp-core$/,
				replacement: new URL("../mcp-core/src/index.ts", import.meta.url).pathname,
			},
			{
				find: /^@nestm\/mcp-gateway$/,
				replacement: new URL("../mcp-gateway/src/index.ts", import.meta.url).pathname,
			},
			{
				find: /^@nestm\/mcp-observability$/,
				replacement: new URL("../mcp-observability/src/index.ts", import.meta.url).pathname,
			},
			{
				find: /^@nestm\/mcp-server$/,
				replacement: new URL("../mcp-server/src/index.ts", import.meta.url).pathname,
			},
		],
	},
	test: {
		include: ["tests/**/*.spec.ts", "tests/**/*.test.ts"],
	},
});
