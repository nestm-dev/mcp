import { describe, expect, it } from "vitest";

import {
	assertFixedGroup,
	assertFixedVersions,
	resolvePrereleaseTag,
} from "../scripts/publish-state.mjs";

const FIXED_GROUP = [
	"@nestm/mcp-core",
	"@nestm/mcp-client",
	"@nestm/mcp-server",
	"@nestm/mcp-auth",
	"@nestm/mcp-observability",
	"@nestm/mcp-gateway",
	"@nestm/mcp",
];

const atVersion = (version: string) => FIXED_GROUP.map((name) => ({ name, version }));

describe("resolvePrereleaseTag", () => {
	it("returns the matching Changesets pre-mode tag", () => {
		expect(resolvePrereleaseTag("0.1.0-alpha.2", { mode: "pre", tag: "alpha" })).toBe("alpha");
		expect(resolvePrereleaseTag("0.1.0-alpha+build.1", { mode: "pre", tag: "alpha" })).toBe(
			"alpha",
		);
	});

	it("allows a stable version outside pre mode", () => {
		expect(resolvePrereleaseTag("1.0.0", undefined)).toBeUndefined();
		expect(resolvePrereleaseTag("1.0.0", { mode: "exit", tag: "alpha" })).toBeUndefined();
	});

	it("rejects a prerelease without Changesets pre mode", () => {
		expect(() => resolvePrereleaseTag("0.1.0-alpha.2", undefined)).toThrow(
			"requires Changesets pre mode",
		);
	});

	it("rejects a prerelease identifier that differs from the tag", () => {
		expect(() => resolvePrereleaseTag("0.1.0-beta.1", { mode: "pre", tag: "alpha" })).toThrow(
			"does not match Changesets tag",
		);
	});

	it("rejects a stable version while pre mode is active", () => {
		expect(() => resolvePrereleaseTag("1.0.0", { mode: "pre", tag: "alpha" })).toThrow(
			"cannot publish in Changesets pre mode",
		);
	});

	it("rejects a non-string version", () => {
		expect(() => resolvePrereleaseTag(undefined, undefined)).toThrow("requires a string version");
	});
});

describe("assertFixedVersions", () => {
	it("returns the shared version and prerelease tag", () => {
		expect(assertFixedVersions(atVersion("0.1.0-alpha.2"), { mode: "pre", tag: "alpha" })).toEqual({
			version: "0.1.0-alpha.2",
			tag: "alpha",
		});
	});

	it("returns no tag for a stable fixed group outside pre mode", () => {
		expect(assertFixedVersions(atVersion("1.2.3"), undefined)).toEqual({
			version: "1.2.3",
			tag: undefined,
		});
	});

	it("refuses to publish a diverged fixed group", () => {
		const packages = [
			...atVersion("0.1.0-alpha.2").slice(0, 6),
			{ name: "@nestm/mcp", version: "0.1.0-alpha.1" },
		];

		expect(() => assertFixedVersions(packages, { mode: "pre", tag: "alpha" })).toThrow(
			/diverged fixed-group versions/,
		);
		expect(() => assertFixedVersions(packages, { mode: "pre", tag: "alpha" })).toThrow(
			/@nestm\/mcp/,
		);
	});

	it("rejects malformed input", () => {
		expect(() => assertFixedVersions([], undefined)).toThrow("at least one package");
		expect(() => assertFixedVersions([{ version: "1.0.0" }], undefined)).toThrow(
			"requires a string name",
		);
		expect(() => assertFixedVersions([{ name: "@nestm/mcp" }], undefined)).toThrow(
			"requires a string version",
		);
	});
});

describe("assertFixedGroup", () => {
	it("accepts a group that matches the workspace packages", () => {
		expect(assertFixedGroup(FIXED_GROUP, [FIXED_GROUP])).toEqual(FIXED_GROUP.toSorted());
	});

	it("rejects a workspace package missing from the group", () => {
		expect(() => assertFixedGroup(FIXED_GROUP, [FIXED_GROUP.slice(1)])).toThrow(
			/missing: @nestm\/mcp-core/,
		);
	});

	it("rejects an unknown fixed-group entry", () => {
		expect(() => assertFixedGroup(FIXED_GROUP, [[...FIXED_GROUP, "@nestm/mcp-extra"]])).toThrow(
			/unknown: @nestm\/mcp-extra/,
		);
	});

	it("requires exactly one fixed group", () => {
		expect(() => assertFixedGroup(FIXED_GROUP, [])).toThrow("exactly one `fixed` group");
		expect(() => assertFixedGroup(FIXED_GROUP, undefined)).toThrow("exactly one `fixed` group");
	});
});
