import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("@nestm/mcp-conformance public boundary", () => {
	it("keeps the kernel free of Nest, manager, client, SDK, and product imports", async () => {
		const files = [
			"comparison.ts",
			"facts.ts",
			"fingerprint.ts",
			"index.ts",
			"junit.ts",
			"limits.ts",
			"plan.ts",
			"report.ts",
			"runner.ts",
			"types.ts",
		];
		const sources = await Promise.all(
			files.map((file) => readFile(new URL(`../src/${file}`, import.meta.url), "utf8")),
		);
		const joined = sources.join("\n");
		expect(joined).not.toMatch(/@nestjs\//u);
		expect(joined).not.toMatch(/@nestm\/mcp-(?:client|core|manager|gateway)/u);
		expect(joined).not.toMatch(/@modelcontextprotocol\//u);
		expect(joined).not.toMatch(/apps\/control-plane/u);
	});
});
