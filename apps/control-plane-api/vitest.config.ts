import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: [
			{
				find: /^@nestm\/mcp-client\/oauth$/,
				replacement: new URL("../../packages/mcp-client/src/oauth/index.ts", import.meta.url)
					.pathname,
			},
			{
				find: /^@nestm\/mcp-gateway$/,
				replacement: new URL("../../packages/mcp-gateway/src/index.ts", import.meta.url).pathname,
			},
			{
				find: /^@nestm\/mcp-core$/,
				replacement: new URL("../../packages/mcp-core/src/index.ts", import.meta.url).pathname,
			},
			{
				find: /^@nestm\/mcp-server\/testing$/,
				replacement: new URL("../../packages/mcp-server/src/testing/index.ts", import.meta.url)
					.pathname,
			},
			{
				find: /^@nestm\/mcp-server$/,
				replacement: new URL("../../packages/mcp-server/src/index.ts", import.meta.url).pathname,
			},
			{
				find: /^@nestm\/mcp-client$/,
				replacement: new URL("../../packages/mcp-client/src/index.ts", import.meta.url).pathname,
			},
			{
				find: /^@nestm\/mcp-manager$/,
				replacement: new URL("../../packages/mcp-manager/src/index.ts", import.meta.url).pathname,
			},
			{
				find: /^@nestm\/mcp-observability$/,
				replacement: new URL("../../packages/mcp-observability/src/index.ts", import.meta.url)
					.pathname,
			},
			{
				find: /^@nestm\/mcp\/manager$/,
				replacement: new URL("../../packages/mcp/src/manager/index.ts", import.meta.url).pathname,
			},
			{
				find: /^@nestm\/mcp$/,
				replacement: new URL("../../packages/mcp/src/index.ts", import.meta.url).pathname,
			},
		],
	},
	test: {
		include: ["tests/**/*.spec.ts", "tests/**/*.test.ts"],
		testTimeout: 15_000,
	},
});
