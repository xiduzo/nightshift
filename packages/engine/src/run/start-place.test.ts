import { describe, expect, test } from "bun:test";
import { Refusal } from "@nightshift/refusal";
import type { Placement, StartRunInput } from "../contract";
import type { RunTrigger } from "../log";
import { NOT_ON_THIS_COMPUTER } from "../projects";
import type { RunSummary } from "../read";
import { createStartPlaces, SCHEDULE_PROJECT_MISSING } from "./start-place";
import { TEST_RUN_FROM_EDITOR } from "./test-run";

/**
 * Who walks a run and its Run's Device, for every start (ADR 1,
 * decisions 9 and 10), and the start that follows. The Host, its Link
 * and the Devices are fakes: `space-own` is kept here, `space-host` by
 * a Host (`host-h`).
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

const SUMMARY = { id: "run-1" } as unknown as RunSummary;

function places(
	options: {
		list?: Placement[];
		lastRun?: string | null;
		reachable?: boolean;
		/** What a start here refuses with. */
		refuse?: Refusal;
	} = {},
) {
	const asked: string[] = [];
	/** Each start, where it went and what it carried. */
	const started: { where: "host" | "here"; input: StartRunInput }[] = [];
	const starts = createStartPlaces({
		ready: Promise.resolve(),
		hostedElsewhere: async (spaceId) => spaceId === "space-host",
		hostReachable: async () => options.reachable ?? true,
		hostOf: async (spaceId) => (spaceId === "space-host" ? "host-h" : null),
		walkerId: async () => HERE,
		placements: async (_spaceId, personId) => {
			asked.push(personId);
			return options.list ?? [here];
		},
		lastRunDevice: async () => options.lastRun ?? null,
		spaceOf: async (projectId) =>
			projectId === "project-hosted" ? "space-host" : "space-own",
		startOnHost: async (input) => {
			started.push({ where: "host", input });
			return SUMMARY;
		},
		startHere: async (_spaceId, input) => {
			if (options.refuse) throw options.refuse;
			started.push({ where: "here", input });
			return SUMMARY;
		},
	});
	return { ...starts, asked, started };
}

const start = (more: { deviceId?: string; deviceName?: string } = {}) => ({
	projectId: "project-1",
	flowName: "flow",
	...more,
});

const MANUAL: RunTrigger = { kind: "manual" };
const SCHEDULED: RunTrigger = {
	kind: "schedule",
	scheduleId: "nightly",
	at: 0,
};

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

describe("a person's start", () => {
	test("goes to the Host that keeps the Space, with where the person started", async () => {
		const p = places();
		const input = {
			...start({ deviceId: "laptop" }),
			projectId: "project-hosted",
		};
		expect(await p.start(input, MANUAL)).toBe(SUMMARY);
		expect(p.started).toEqual([
			{ where: "host", input: { ...input, startedFrom: HERE } },
		]);
	});

	test("starts here in a Space this Replica keeps, with the pick as the Run's Device", async () => {
		const p = places();
		await p.start(start(), MANUAL);
		await p.start(start({ deviceId: "desktop" }), MANUAL);
		expect(p.started).toEqual([
			{ where: "here", input: start() },
			{ where: "here", input: start({ deviceId: "desktop" }) },
		]);
	});
});

describe("a test run's start (ADR 27)", () => {
	const marks = { skipped: { approve: "send" } };

	test("goes to the Host with its pins and skips, as a person starts it", async () => {
		const p = places();
		const input = { ...start(), projectId: "project-hosted", test: marks };
		await p.start(input, MANUAL);
		expect(p.started).toEqual([
			{ where: "host", input: { ...input, startedFrom: HERE } },
		]);
	});

	test("is refused for a schedule before it goes anywhere: the Host's start knows no trigger", async () => {
		const p = places();
		for (const projectId of ["project-hosted", "project-1"]) {
			await expect(
				p.start({ ...start(), projectId, test: marks }, SCHEDULED),
			).rejects.toThrow(TEST_RUN_FROM_EDITOR);
		}
		expect(p.started).toEqual([]);
	});
});

describe("a schedule's start", () => {
	test("runs on the Replica that keeps the Space: the Host, else this computer (ADR 15)", async () => {
		const p = places();
		await p.startForSchedule(start(), SCHEDULED);
		await p.startForSchedule(
			{ ...start(), projectId: "project-hosted" },
			SCHEDULED,
		);
		expect(p.started.map((s) => [s.where, s.input.deviceId])).toEqual([
			["here", HERE],
			["host", "host-h"],
		]);
	});

	test("says where the project is missing in the words of a schedule", async () => {
		const p = places({ refuse: new Refusal("conflict", NOT_ON_THIS_COMPUTER) });
		await expect(p.startForSchedule(start(), SCHEDULED)).rejects.toThrow(
			SCHEDULE_PROJECT_MISSING,
		);
		const other = places({ refuse: new Refusal("invalid", "Not valid.") });
		await expect(other.startForSchedule(start(), SCHEDULED)).rejects.toThrow(
			"Not valid.",
		);
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
