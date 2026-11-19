import { describe, expect, test } from "bun:test";
import type { Placement } from "../../../contract";
import { defaultOf, markDefault, placeOf, usable } from "./start-place";

/**
 * Who walks a run and its Run's Device, for every start (ADR 1,
 * decisions 9 and 10), and the default a screen preselects.
 */

const HERE = "this-computer";
const here: Placement = { deviceId: HERE, name: "Here", thisDevice: true };
const laptop: Placement = {
	deviceId: "laptop",
	name: "Laptop",
	thisDevice: false,
};
const desktop: Placement = {
	deviceId: "desktop",
	name: "Desktop",
	thisDevice: false,
};
const kims: Placement = {
	deviceId: "kims",
	name: "Kim's Mac",
	thisDevice: false,
	offers: ["claude"],
};
const hostOfKim: Placement = {
	deviceId: "host",
	name: "Kim's Host",
	thisDevice: false,
	offers: [],
};

describe("who walks the run", () => {
	test("the Host, when it keeps the Space and this computer reaches it: it hears where you started (decision 9, ADR 17)", () => {
		expect(placeOf({}, HERE)).toEqual({ walker: "host", startedFrom: HERE });
		expect(placeOf({ deviceId: "laptop" }, HERE)).toEqual({
			walker: "host",
			startedFrom: HERE,
			deviceId: "laptop",
		});
	});

	test("else this computer, with the person's pick as the Run's Device, or the plan decides (decision 10)", () => {
		expect(placeOf({}, null)).toEqual({ walker: "here" });
		expect(placeOf({ deviceId: "laptop" }, null)).toEqual({
			walker: "here",
			deviceId: "laptop",
		});
	});
});

describe("the Devices a person chooses from", () => {
	test("mark the latest run's Device and the one default a start takes", () => {
		expect(markDefault([laptop, desktop, kims], "desktop")).toEqual([
			laptop,
			{ ...desktop, lastRun: true, default: true },
			kims,
		]);
		expect(markDefault([], null)).toEqual([]);
	});

	test("this computer is the default, also when the latest run ran elsewhere", () => {
		expect(markDefault([laptop, here], "laptop")).toEqual([
			{ ...laptop, lastRun: true },
			{ ...here, default: true },
		]);
	});

	test("a Device another Person owns that offers nothing is no default", () => {
		expect(usable(hostOfKim)).toBe(false);
		expect(usable(kims)).toBe(true);
		expect(usable(laptop)).toBe(true);
		expect(defaultOf([hostOfKim, kims, laptop])).toEqual(laptop);
		expect(
			markDefault([{ ...hostOfKim, thisDevice: true }, laptop], "host"),
		).toEqual([
			{ ...hostOfKim, thisDevice: true, lastRun: true },
			{ ...laptop, default: true },
		]);
		// When it is all there is, it is the first.
		expect(defaultOf([hostOfKim])).toEqual(hostOfKim);
		expect(defaultOf([])).toBeNull();
	});
});
