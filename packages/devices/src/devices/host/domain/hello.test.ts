import { describe, expect, test } from "bun:test";
import { isHomeDevice, ownDevicesForHello, spacesForHello } from "./hello";

describe("hello", () => {
	test("a home Device gets the personal Space; a guest Device does not", () => {
		const spaces = [
			{ name: "Personal", personal: true },
			{ name: "Platform", personal: false },
		];
		expect(spacesForHello(spaces, true).map((s) => s.name)).toEqual([
			"Personal",
			"Platform",
		]);
		expect(spacesForHello(spaces, false).map((s) => s.name)).toEqual([
			"Platform",
		]);
	});

	test("own Devices are the owner's home Devices and this Host when they own it, never another, never revoked", () => {
		const others = [
			{
				id: "desktop",
				name: "desktop",
				revokedAt: null,
				homeHost: "https://studio.invalid",
			},
			{
				id: "old",
				name: "old",
				revokedAt: 5,
				homeHost: "https://studio.invalid",
			},
			{
				id: "travel",
				name: "travel",
				revokedAt: null,
				homeHost: null,
			},
			{
				id: "laptop",
				name: "laptop",
				revokedAt: null,
				homeHost: "https://studio.invalid",
			},
		];
		const self = { id: "host-a", name: "Studio" };
		expect(ownDevicesForHello(others, self, true, "laptop")).toEqual([
			{ id: "host-a", name: "Studio" },
			{ id: "desktop", name: "desktop" },
		]);
		expect(ownDevicesForHello(others, self, false, "bobs")).toEqual([
			{ id: "desktop", name: "desktop" },
			{ id: "laptop", name: "laptop" },
		]);
	});

	test("home is the address it joined by", () => {
		expect(isHomeDevice("https://studio.invalid")).toBe(true);
		expect(isHomeDevice(null)).toBe(false);
	});
});
