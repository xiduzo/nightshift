import { describe, expect, test } from "bun:test";
import { spaceDevices } from "./device-names";

describe("spaceDevices", () => {
	test("names the Devices with a Clone and those that offer a profile", () => {
		const found = spaceDevices({
			devices: new Map<string, unknown>([
				["mac", { name: "MacBook" }],
				["blank", { name: "" }],
				["odd", 7],
			]),
			offers: new Map<string, unknown>([
				["box/p", { deviceId: "box", deviceName: "hetzner-1" }],
				["nameless/p", { deviceId: "nameless" }],
				["broken/p", { deviceName: "nobody" }],
			]),
		});
		expect(found).toEqual([
			{ id: "mac", name: "MacBook" },
			{ id: "blank", name: null },
			{ id: "odd", name: null },
			{ id: "box", name: "hetzner-1" },
			{ id: "nameless", name: null },
		]);
	});
});
