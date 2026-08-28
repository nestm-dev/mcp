import { defineConfig } from "tsdown";

export default defineConfig({
	entry: ["src/index.ts", "src/json-document.ts", "src/json-schema-arguments.ts"],
	format: ["esm"],
	platform: "browser",
	target: "es2022",
	dts: true,
	sourcemap: true,
	clean: true,
	fixedExtension: true,
});
