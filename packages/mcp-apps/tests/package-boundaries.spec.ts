import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("server-only package boundaries", () => {
	it("keeps source independent of Nest, gateway, browser Apps SDK, and adapter packages", () => {
		const sourceDirectory = join(import.meta.dirname, "..", "src");
		const source = readdirSync(sourceDirectory)
			.filter((name) => name.endsWith(".ts"))
			.map((name) => readFileSync(join(sourceDirectory, name), "utf8"))
			.join("\n");
		const forbiddenImportTargets = [
			"@nestjs/",
			"@nestm/mcp-core",
			"@nestm/mcp-gateway",
			["@modelcontextprotocol", "ext-apps"].join("/"),
			["@nestm", "muse"].join("/"),
		];

		for (const target of forbiddenImportTargets) {
			expect(source, `unexpected production dependency on ${target}`).not.toContain(target);
		}
	});

	it("does not declare Muse adapter dependencies", () => {
		const manifest = readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8");
		const forbiddenPackageNames = [["@nestm", "muse"].join("/"), ["conceptadev", "muse"].join("/")];

		for (const packageName of forbiddenPackageNames) {
			expect(manifest, `unexpected package dependency on ${packageName}`).not.toContain(
				packageName,
			);
		}
	});
});
