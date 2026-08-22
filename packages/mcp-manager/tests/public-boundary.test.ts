import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("@nestm/mcp-manager public boundary", () => {
	it("keeps the neutral package free of Nest and product-application imports", async () => {
		const sources = await Promise.all(
			[
				"errors.ts",
				"index.ts",
				"runtime-factory.ts",
				"runtime-manager.ts",
				"runtime-state.ts",
				"types.ts",
			].map((file) => readFile(new URL(`../src/${file}`, import.meta.url), "utf8")),
		);
		const joined = sources.join("\n");
		expect(joined).not.toMatch(/@nestjs\//);
		expect(joined).not.toMatch(/apps\/control-plane-api/);
		expect(joined).not.toMatch(/ConnectionRepository|EndpointAdmission|ControlPlaneError/);
	});
});
