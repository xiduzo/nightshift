/// <reference types="bun" />
import { describe, expect, test } from "bun:test";

import { hostAddressOf, needsHttps } from "./address";

describe("a Host address", () => {
	test("is the origin of what the person typed, with https:// when it has no scheme", () => {
		expect(hostAddressOf(" nightshift.example.com/inbox ")).toBe(
			"https://nightshift.example.com",
		);
		expect(hostAddressOf("https://192.168.1.10:3000")).toBe(
			"https://192.168.1.10:3000",
		);
		expect(hostAddressOf("")).toBeNull();
		expect(hostAddressOf("ftp://example.com")).toBeNull();
	});

	test("never sends the session over plain http:// in a release build", () => {
		expect(hostAddressOf("http://192.168.1.10", { allowHttp: false })).toBe(
			null,
		);
		expect(hostAddressOf("http://192.168.1.10")).toBeNull();
		expect(needsHttps("http://192.168.1.10")).toBe(true);
		expect(needsHttps("nightshift.example.com")).toBe(false);
	});

	test("takes http:// in a development build", () => {
		expect(hostAddressOf("http://192.168.1.10:3000", { allowHttp: true })).toBe(
			"http://192.168.1.10:3000",
		);
	});
});
