import { describe, expect, test } from "bun:test";
import { DAY_MS } from "@nightshift/time";
import {
	bearerDeviceKey,
	createVerifiedKeys,
	isDeviceKey,
	keyAllows,
	keyName,
	movedExpiry,
	newKeyPermissions,
	VERIFIED_MS,
} from "./device-keys";

const ACCESS = {
	keyId: "k",
	deviceId: "device-b",
	personId: "ada",
	permissions: newKeyPermissions(),
};

describe("a Device key", () => {
	test("is known by its prefix, also in a bearer header", () => {
		expect(isDeviceKey("nsd_abc")).toBe(true);
		expect(isDeviceKey("a-session-token")).toBe(false);
		expect(isDeviceKey(null)).toBe(false);
		expect(
			bearerDeviceKey(new Headers({ authorization: "Bearer nsd_abc" })),
		).toBe("nsd_abc");
		expect(
			bearerDeviceKey(new Headers({ authorization: "Bearer other" })),
		).toBeNull();
	});

	test("allows a permission only with all of its actions", () => {
		expect(keyAllows(newKeyPermissions(), "sync")).toBe(true);
		expect(keyAllows({ sync: ["pull"] }, "sync")).toBe(false);
		expect(keyAllows({}, "relay")).toBe(false);
	});

	test("is named for its Device", () => {
		expect(keyName("MacBook")).toBe("MacBook");
		expect(keyName("")).toBe("Device");
		expect(keyName("x".repeat(40))).toHaveLength(32);
	});
});

describe("movedExpiry", () => {
	test("moves the expiry at most once a day", () => {
		const idle = 30 * DAY_MS;
		expect(movedExpiry(null, 0, idle)).toBe(idle);
		expect(movedExpiry(idle - DAY_MS + 1, 0, idle)).toBeNull();
		expect(movedExpiry(idle - 2 * DAY_MS, 0, idle)).toBe(idle);
	});
});

describe("createVerifiedKeys", () => {
	test("keeps a key for a minute, and drops a revoked Device's keys", () => {
		const keys = createVerifiedKeys();
		keys.keep("h", { access: ACCESS, expiresAt: null, checkedAt: 0 });
		expect(keys.fresh("h", VERIFIED_MS - 1)?.access).toBe(ACCESS);
		expect(keys.fresh("h", VERIFIED_MS)).toBeNull();
		expect(keys.fresh("h", 0)).toBeNull();
		keys.keep("h", { access: ACCESS, expiresAt: null, checkedAt: 0 });
		keys.dropDevice("device-b");
		expect(keys.fresh("h", 0)).toBeNull();
	});
});
