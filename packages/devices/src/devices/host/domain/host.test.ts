import { describe, expect, test } from "bun:test";
import { Refusal } from "@nightshift/refusal";
import { NOT_A_HOST } from "../../../contract";
import { createDeviceVersions, requireHost } from "./host";

describe("requireHost", () => {
	test("refuses while Be a Host is off, in those words", () => {
		expect(() => requireHost(false)).toThrow(Refusal);
		expect(() => requireHost(false)).toThrow(NOT_A_HOST);
		expect(() => requireHost(true)).not.toThrow();
	});
});

test("a Device of another version is remembered until it calls with this one", () => {
	const versions = createDeviceVersions();
	expect(versions.of("laptop")).toBeNull();
	versions.said("laptop", "older");
	expect(versions.of("laptop")).toBe("older");
	expect(versions.of("desktop")).toBeNull();
	versions.said("laptop", null);
	expect(versions.of("laptop")).toBeNull();
});
