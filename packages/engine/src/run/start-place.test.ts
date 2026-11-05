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
	test("in a Space a Host keeps, the Host, and it hears where you started (decision 9, ADR 17)", async () => {
		const p = places();
		expect(await p.place("space-host", start())).toEqual({
			walker: "host",
			startedFrom: HERE,
		});
		expect(await p.place("space-host", start({ deviceId: "laptop" }))).toEqual({
			walker: "host",
			startedFrom: HERE,
			deviceId: "laptop",
		});
		expect(p.asked).toEqual([]);
	});

	test("a Device that cannot reach its Host walks the run itself (decision 10)", async () => {
		const p = places({ reachable: false });
		expect(await p.place("space-host", start())).toEqual({ walker: "here" });
		expect(await p.place("space-host", start({ deviceId: "laptop" }))).toEqual({
			walker: "here",
			deviceId: "laptop",
		});
	});

	test("in a Space this Replica keeps, this computer: the plan decides the Device", async () => {
		const p = places({ list: [laptop] });
		expect(await p.place("space-own", start())).toEqual({ walker: "here" });
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
