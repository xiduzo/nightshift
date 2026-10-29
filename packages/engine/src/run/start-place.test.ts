import { describe, expect, test } from "bun:test";
import type { Placement } from "../contract";
import { createStartPlaces } from "./start-place";

/**
 * Who walks a run and its Run's Device, for every start (ADR 1,
 * decisions 9 and 10). The Host, its Link and the Devices are fakes:
 * `space-own` is kept here, `space-host` by a Host.
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

function places(
	options: {
		list?: Placement[];
		lastRun?: string | null;
		reachable?: boolean;
	} = {},
) {
	const asked: string[] = [];
	const starts = createStartPlaces({
		hostedElsewhere: async (spaceId) => spaceId === "space-host",
		hostReachable: async () => options.reachable ?? true,
		walkerId: async () => HERE,
		placements: async (_spaceId, personId) => {
			asked.push(personId);
			return options.list ?? [here];
		},
		lastRunDevice: async () => options.lastRun ?? null,
	});
	return { ...starts, asked };
}

const start = (more: { deviceId?: string; deviceName?: string } = {}) => ({
	projectId: "project-1",
	flowName: "flow",
	...more,
});

describe("who walks the run", () => {
	test("in a Space a Host keeps, the Host, and the unplaced steps run where you are (decision 9)", async () => {
		const p = places();
		expect(await p.place("space-host", start(), "ada")).toEqual({
			walker: "host",
			deviceId: HERE,
		});
		expect(
			await p.place("space-host", start({ deviceId: "laptop" }), "ada"),
		).toEqual({ walker: "host", deviceId: "laptop" });
		// The Host decides the rest: this computer asks for no default.
		expect(p.asked).toEqual([]);
	});

	test("a Device that cannot reach its Host walks the run itself (decision 10)", async () => {
		const p = places({ reachable: false });
		expect(await p.place("space-host", start(), "ada")).toEqual({
			walker: "here",
		});
		expect(
			await p.place("space-host", start({ deviceId: "laptop" }), "ada"),
		).toEqual({ walker: "here", deviceId: "laptop" });
	});

	test("in a Space this Replica keeps, this computer, reachable Host or not", async () => {
		const p = places({ list: [laptop] });
		expect(await p.place("space-own", start(), "ada")).toEqual({
			walker: "here",
			deviceId: "laptop",
		});
	});
});

describe("the Run's Device when the start names none", () => {
	test("this computer when it has the project", async () => {
		const p = places({ list: [here, laptop], lastRun: "laptop" });
		expect(await p.place("space-own", start(), "ada")).toEqual({
			walker: "here",
		});
	});

	test("else the Device of the project's latest run, else one of the Person's own, else the first", async () => {
		expect(
			await places({ list: [laptop, desktop], lastRun: "desktop" }).place(
				"space-own",
				start(),
				"ada",
			),
		).toEqual({ walker: "here", deviceId: "desktop" });
		expect(
			await places({ list: [kims, laptop] }).place("space-own", start(), "ada"),
		).toEqual({ walker: "here", deviceId: "laptop" });
		expect(
			await places({ list: [kims] }).place("space-own", start(), "ada"),
		).toEqual({ walker: "here", deviceId: "kims" });
	});

	test("a Host another Person owns that offers nothing is no default, not even as the latest run's", async () => {
		const theirs = { ...here, offers: [] };
		const p = places({ list: [theirs, laptop], lastRun: HERE });
		expect(await p.place("space-own", start(), "ada")).toEqual({
			walker: "here",
			deviceId: "laptop",
		});
		// When it offers a profile, it is the default.
		const offering = places({
			list: [{ ...here, offers: ["claude"] }, laptop],
		});
		expect(await offering.place("space-own", start(), "ada")).toEqual({
			walker: "here",
		});
	});

	test("the Device a schedule names, or this computer for a start for nobody, asks for no default", async () => {
		const p = places({ list: [laptop] });
		expect(
			await p.place("space-own", start({ deviceName: "Desktop" }), "ada"),
		).toEqual({ walker: "here" });
		expect(await p.place("space-own", start(), null)).toEqual({
			walker: "here",
		});
		expect(p.asked).toEqual([]);
	});
});

describe("the Devices a person chooses from", () => {
	test("mark the latest run's Device and the one default a start takes", async () => {
		const p = places({ list: [laptop, desktop, kims], lastRun: "desktop" });
		expect(await p.placements("space-own", "ada", "project-1")).toEqual([
			laptop,
			{ ...desktop, lastRun: true, default: true },
			kims,
		]);
		expect(
			await places({ list: [] }).placements("space-own", "ada", "p"),
		).toEqual([]);
	});
});
