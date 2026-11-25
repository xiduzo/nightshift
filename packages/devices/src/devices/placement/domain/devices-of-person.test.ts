import { describe, expect, test } from "bun:test";
import { fromCopies, fromHost, othersPaired } from "./devices-of-person";

test("the paired Devices with access count, without this computer", () => {
	const paired = [
		{ id: "a", revokedAt: null },
		{ id: "removed", revokedAt: 1 },
		{ id: "self", revokedAt: null },
	];
	expect(othersPaired(paired, "self").map((d) => d.id)).toEqual(["a"]);
});

describe("the Devices a Host lists", () => {
	const copies = [{ deviceId: "a", name: "A", profiles: ["copied"] }];
	const listed = (more: { offers?: string[]; profiles?: string[] } = {}) =>
		fromHost([{ deviceId: "a", thisDevice: true, ...more }], copies, "self");

	test("leave this computer out", () => {
		expect(fromHost([{ deviceId: "self" }], [], "self")).toEqual([]);
	});

	test("are none of them this computer, and take the profiles of their copy", () => {
		expect(listed()).toEqual([
			{ deviceId: "a", thisDevice: false, profiles: ["copied"] },
		]);
	});

	test("keep the profiles the Host tells", () => {
		expect(listed({ profiles: ["told"] })[0]?.profiles).toEqual(["told"]);
	});

	test("take no profiles of a copy where another Person offers them", () => {
		expect(listed({ offers: ["x"] })[0]).not.toHaveProperty("profiles");
	});
});

test("a copy tells a Device offline: its name, else the one known, else a plain one", () => {
	const named = (name: string | null, known: string | null) =>
		fromCopies([{ deviceId: "a", name, profiles: ["p"] }], {
			deviceName: () => known,
			hasProject: (id) => id === "a",
		})[0];
	expect(named("A", "other")).toEqual({
		deviceId: "a",
		name: "A",
		thisDevice: false,
		online: false,
		hasClone: true,
		profiles: ["p"],
	});
	expect(named(null, "known")?.name).toBe("known");
	expect(named(null, null)?.name).toBe("Device");
});
