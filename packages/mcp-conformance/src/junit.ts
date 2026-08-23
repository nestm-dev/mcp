import { MCP_CONFORMANCE_HARD_LIMITS } from "./limits.ts";
import type { McpConformanceCheckReport, McpConformanceReport } from "./report.ts";

export function toMcpConformanceJUnit(report: McpConformanceReport): string {
	const failures = report.counts.fail;
	const errors = report.counts.error;
	const skipped = report.counts.skip;
	const durationSeconds = (report.durationMs / 1_000).toFixed(3);
	const cases = report.checks.map((check) => renderCase(report.plan.id, check)).join("");
	const xml =
		`<?xml version="1.0" encoding="UTF-8"?>` +
		`<testsuites tests="${String(report.checks.length)}" failures="${String(failures)}" errors="${String(errors)}" skipped="${String(skipped)}" time="${durationSeconds}">` +
		`<testsuite name="${escapeXml(report.plan.title)}" tests="${String(report.checks.length)}" failures="${String(failures)}" errors="${String(errors)}" skipped="${String(skipped)}" time="${durationSeconds}">` +
		`<properties><property name="mcp.run_id" value="${escapeXml(report.runId)}"/><property name="mcp.completion" value="${report.completion}"/><property name="mcp.verdict" value="${report.verdict}"/><property name="mcp.plan_digest" value="${report.plan.digest}"/></properties>` +
		cases +
		`</testsuite></testsuites>`;
	if (Buffer.byteLength(xml, "utf8") > MCP_CONFORMANCE_HARD_LIMITS.maxJunitBytes) {
		throw new RangeError("The JUnit report exceeds the 4 MiB safety limit.");
	}
	return xml;
}

function renderCase(planId: string, check: McpConformanceCheckReport): string {
	const header = `<testcase classname="${escapeXml(planId)}" name="${escapeXml(check.title)}" time="${(check.durationMs / 1_000).toFixed(3)}">`;
	const code = escapeXml(check.code);
	switch (check.status) {
		case "pass":
			return `${header}</testcase>`;
		case "warn":
			return `${header}<properties><property name="mcp.status" value="warn"/><property name="mcp.code" value="${code}"/></properties><system-out>${code}</system-out></testcase>`;
		case "fail":
			return `${header}<failure type="McpConformanceFailure" message="${code}">${code}</failure></testcase>`;
		case "error":
			return `${header}<error type="McpConformanceError" message="${code}">${code}</error></testcase>`;
		case "skip":
			return `${header}<skipped message="${code}"/></testcase>`;
	}
	throw new TypeError("Unknown MCP conformance check status.");
}

function escapeXml(value: string): string {
	return stripIllegalXmlCharacters(value)
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");
}

function stripIllegalXmlCharacters(value: string): string {
	let safe = "";
	for (const character of value) {
		const codePoint = character.codePointAt(0);
		if (
			codePoint === undefined ||
			(codePoint !== 0x09 &&
				codePoint !== 0x0a &&
				codePoint !== 0x0d &&
				!(codePoint >= 0x20 && codePoint <= 0xd7ff) &&
				!(codePoint >= 0xe000 && codePoint <= 0xfffd) &&
				!(codePoint >= 0x10_000 && codePoint <= 0x10_ffff))
		) {
			continue;
		}
		safe += character;
	}
	return safe;
}
