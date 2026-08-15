import { describe, expect, it } from "vitest";
import { isBlockedDocumentAddress, normalizeGuardedRequest } from "../src/cimd/index.ts";

describe("normalizeGuardedRequest", () => {
	it("preserves a Headers instance (Content-Type and Basic auth survive)", () => {
		const basic = `Basic ${Buffer.from("client:secret").toString("base64")}`;
		const { headers } = normalizeGuardedRequest("idp.example.com", {
			headers: new Headers({
				"content-type": "application/x-www-form-urlencoded",
				authorization: basic,
				accept: "application/json",
			}),
		});
		expect(headers["authorization"]).toBe(basic);
		expect(headers["content-type"]).toBe("application/x-www-form-urlencoded");
		expect(headers["accept"]).toBe("application/json");
		expect(headers["host"]).toBe("idp.example.com");
	});

	it("serializes a URLSearchParams body and sets content-length + type", () => {
		const body = new URLSearchParams({ grant_type: "authorization_code", code: "abc" });
		const result = normalizeGuardedRequest("idp.example.com", { body });
		expect(result.body?.toString("utf8")).toBe("grant_type=authorization_code&code=abc");
		expect(result.headers["content-length"]).toBe(String(result.body?.byteLength));
		expect(result.headers["content-type"]).toBe("application/x-www-form-urlencoded;charset=UTF-8");
	});

	it("accepts string and Uint8Array bodies and rejects unsupported ones", () => {
		expect(normalizeGuardedRequest("h", { body: "raw" }).body?.toString()).toBe("raw");
		expect(normalizeGuardedRequest("h", { body: new Uint8Array([1, 2, 3]) }).body?.byteLength).toBe(
			3,
		);
		// A ReadableStream is a valid BodyInit but the guarded fetch does not stream.
		expect(() => normalizeGuardedRequest("h", { body: new ReadableStream() })).toThrowError();
	});

	it("does not let an incoming header override the pinned Host", () => {
		const { headers } = normalizeGuardedRequest("idp.example.com", {
			headers: { host: "attacker.example" },
		});
		expect(headers["host"]).toBe("idp.example.com");
	});
});

describe("isBlockedDocumentAddress IPv6 hardening", () => {
	it.each([
		"fec0::1", // site-local
		"::ffff:0:7f00:1", // v4-translated ::ffff:0:0:0/96 → 127.0.0.1
		"fe80::1",
		"fc00::1",
		"ff02::1",
		"2001:db8::1",
	])("blocks non-global or embedded-private %s", (address) => {
		expect(isBlockedDocumentAddress(address)).toBe(true);
	});

	it.each(["2606:4700:4700::1111", "2600:1f18::1"])("allows global unicast %s", (address) => {
		expect(isBlockedDocumentAddress(address)).toBe(false);
	});
});
