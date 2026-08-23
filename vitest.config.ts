import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: [
			{
				find: /^@nestm\/mcp-client\/oauth$/,
				replacement: new URL("./packages/mcp-client/src/oauth/index.ts", import.meta.url).pathname,
			},
			{
				find: /^@nestm\/mcp-server\/auth$/,
				replacement: new URL("./packages/mcp-server/src/auth/index.ts", import.meta.url).pathname,
			},
			{
				find: /^@nestm\/mcp-server\/security$/,
				replacement: new URL("./packages/mcp-server/src/security/index.ts", import.meta.url)
					.pathname,
			},
			{
				find: /^@nestm\/mcp-server\/testing$/,
				replacement: new URL("./packages/mcp-server/src/testing/index.ts", import.meta.url)
					.pathname,
			},
			{
				find: /^@nestm\/mcp-auth\/cimd$/,
				replacement: new URL("./packages/mcp-auth/src/cimd/index.ts", import.meta.url).pathname,
			},
			{
				find: /^@nestm\/mcp-auth\/stores$/,
				replacement: new URL("./packages/mcp-auth/src/stores/index.ts", import.meta.url).pathname,
			},
			{
				find: /^@nestm\/mcp-auth\/testing$/,
				replacement: new URL("./packages/mcp-auth/src/testing/index.ts", import.meta.url).pathname,
			},
			{
				find: /^@nestm\/mcp-auth$/,
				replacement: new URL("./packages/mcp-auth/src/index.ts", import.meta.url).pathname,
			},
			{
				find: /^@nestm\/mcp-gateway\/testing$/,
				replacement: new URL("./packages/mcp-gateway/src/testing/index.ts", import.meta.url)
					.pathname,
			},
			{
				find: /^@nestm\/mcp\/testing$/,
				replacement: new URL("./packages/mcp/src/testing/index.ts", import.meta.url).pathname,
			},
			{
				find: /^@nestm\/mcp-core$/,
				replacement: new URL("./packages/mcp-core/src/index.ts", import.meta.url).pathname,
			},
			{
				find: /^@nestm\/mcp-client$/,
				replacement: new URL("./packages/mcp-client/src/index.ts", import.meta.url).pathname,
			},
			{
				find: /^@nestm\/mcp-manager$/,
				replacement: new URL("./packages/mcp-manager/src/index.ts", import.meta.url).pathname,
			},
			{
				find: /^@nestm\/mcp-conformance$/,
				replacement: new URL("./packages/mcp-conformance/src/index.ts", import.meta.url).pathname,
			},
			{
				find: /^@nestm\/mcp-server$/,
				replacement: new URL("./packages/mcp-server/src/index.ts", import.meta.url).pathname,
			},
			{
				find: /^@nestm\/mcp-gateway$/,
				replacement: new URL("./packages/mcp-gateway/src/index.ts", import.meta.url).pathname,
			},
			{
				find: /^@nestm\/mcp-observability$/,
				replacement: new URL("./packages/mcp-observability/src/index.ts", import.meta.url).pathname,
			},
			{
				find: /^@nestm\/mcp\/manager$/,
				replacement: new URL("./packages/mcp/src/manager/index.ts", import.meta.url).pathname,
			},
			{
				find: /^@nestm\/mcp$/,
				replacement: new URL("./packages/mcp/src/index.ts", import.meta.url).pathname,
			},
		],
	},
	test: {
		coverage: {
			exclude: ["**/*.config.ts", "**/index.ts", "references/**"],
			provider: "v8",
			reporter: ["text", "json", "html"],
		},
		exclude: ["references/**", "**/dist/**", "**/node_modules/**"],
		include: [
			"packages/**/*.spec.ts",
			"packages/**/*.test.ts",
			"apps/control-plane-api/**/*.spec.ts",
			"apps/control-plane-api/**/*.test.ts",
			"tests/**/*.test.ts",
		],
		testTimeout: 15_000,
	},
});
