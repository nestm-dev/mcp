import { glob, readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("control-plane package boundary", () => {
	it("uses only public NestM exports and keeps product authority out of the supervisor", async () => {
		const projectRoot = new URL("../", import.meta.url);
		const sourceFiles: string[] = [];
		for await (const sourceFile of glob("src/**/*.ts", { cwd: projectRoot })) {
			sourceFiles.push(sourceFile);
		}
		const source = await Promise.all(
			sourceFiles.map((sourceFile) => readFile(new URL(sourceFile, projectRoot), "utf8")),
		);
		const completeSource = source.join("\n");
		expect(completeSource).not.toMatch(/@nestm\/[^"\n]+\/src(?:\/|")/u);
		expect(completeSource).not.toMatch(/\.\.\/\.\.\/\.\.\/packages\//u);

		const runtimeFiles: string[] = [];
		for await (const sourceFile of glob("src/runtime/**/*.ts", { cwd: projectRoot })) {
			runtimeFiles.push(sourceFile);
		}
		const runtimeSource = (
			await Promise.all(
				runtimeFiles.map((sourceFile) => readFile(new URL(sourceFile, projectRoot), "utf8")),
			)
		).join("\n");
		expect(runtimeSource).not.toMatch(/\b(?:tenant|workspace|installation|credentialOwner)\b/u);
		expect(runtimeSource).not.toMatch(/connections\/connection\.types/u);
		expect(runtimeSource).not.toMatch(/\b(?:connectionId|runtimeGeneration)\b/u);
	});
});
