import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("headless browser package boundaries", () => {
	it("keeps production source independent of renderers, app contracts, and Node APIs", () => {
		const sourceDirectory = join(import.meta.dirname, "..", "src");
		const source = readdirSync(sourceDirectory)
			.filter((name) => name.endsWith(".ts"))
			.map((name) => readFileSync(join(sourceDirectory, name), "utf8"))
			.join("\n");
		const forbiddenImportTargets = [
			"react",
			"@base-ui/",
			"@codemirror/",
			"@uiw/",
			"@/",
			'from "node:',
			"from 'node:",
		];

		for (const target of forbiddenImportTargets) {
			expect(source, `unexpected production dependency on ${target}`).not.toContain(target);
		}
	});

	it("declares no runtime dependencies", () => {
		const manifest: unknown = JSON.parse(
			readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8"),
		);
		if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
			throw new TypeError("The package manifest must be a JSON object.");
		}

		expect(Object.hasOwn(manifest, "dependencies")).toBe(false);
	});
});
