import { describe, expect, test } from "bun:test";
import { Refusal } from "@nightshift/refusal";
import type { StartRunInput } from "../../../contract";
import type { RunTrigger } from "../../../log";
import { NOT_ON_THIS_COMPUTER } from "../../../projects";
import type { RunSummary } from "../../../read";
import {
	HERE,
	inMemoryStartPorts,
} from "../adapters/out/in-memory-start-ports";
import { SCHEDULE_PROJECT_MISSING } from "../domain/start-place";
import { TEST_RUN_FROM_EDITOR } from "../domain/test-run";
import { startScheduledRun } from "./start-scheduled-run";

/**
 * A schedule's or a webhook's start, on in-memory adapters: it runs on
 * the Replica that keeps the Space (ADR 15). `space-own` is kept here,
 * `space-host` by a Host (`host-h`).
 */

const SUMMARY = { id: "run-1" } as unknown as RunSummary;
const SCHEDULED: RunTrigger = {
	kind: "schedule",
	scheduleId: "nightly",
	at: 0,
};

function places(options: { refuse?: Refusal } = {}) {
	const ports = inMemoryStartPorts();
	ports.projects.add({ id: "project-1", spaceId: "space-own" });
	ports.projects.add({ id: "project-hosted", spaceId: "space-host" });
	ports.keeper.hostedBy("space-host", "host-h");
	ports.keeper.link("space-host", true);
	const started: {
		where: "host" | "here";
		spaceId: string;
		input: StartRunInput;
		trigger?: RunTrigger;
	}[] = [];
	const start = startScheduledRun({
		...ports,
		here: async ({ spaceId, input, trigger }) => {
			if (options.refuse) throw options.refuse;
			started.push({ where: "here", spaceId, input, trigger });
			return SUMMARY;
		},
		onHost: async ({ spaceId, input }) => {
			started.push({ where: "host", spaceId, input });
			return SUMMARY;
		},
	});
	return { ports, started, start };
}

const input = (projectId = "project-1"): StartRunInput => ({
	projectId,
	flowName: "flow",
});

describe("a schedule's start", () => {
	test("runs on the Replica that keeps the Space: the Host, else this computer (ADR 15)", async () => {
		const p = places();
		expect(await p.start({ input: input(), trigger: SCHEDULED })).toBe(SUMMARY);
		await p.start({ input: input("project-hosted"), trigger: SCHEDULED });
		expect(p.started.map((s) => [s.where, s.input.deviceId])).toEqual([
			["here", HERE],
			["host", "host-h"],
		]);
		expect(p.started[0]).toMatchObject({
			spaceId: "space-own",
			trigger: SCHEDULED,
		});
		expect(p.started[1]?.input.startedFrom).toBe(HERE);
	});

	test("a Space whose Host this computer does not reach: this computer walks it, on the Host as its Device", async () => {
		const p = places();
		p.ports.keeper.link("space-host", false);
		await p.start({ input: input("project-hosted"), trigger: SCHEDULED });
		expect(p.started.map((s) => [s.where, s.input.deviceId])).toEqual([
			["here", "host-h"],
		]);
	});

	test("says where the project is missing in the words of a schedule", async () => {
		const p = places({ refuse: new Refusal("conflict", NOT_ON_THIS_COMPUTER) });
		await expect(
			p.start({ input: input(), trigger: SCHEDULED }),
		).rejects.toThrow(SCHEDULE_PROJECT_MISSING);
		await expect(
			p.start({ input: input(), trigger: SCHEDULED }),
		).rejects.toMatchObject({ kind: "conflict" });
		const other = places({ refuse: new Refusal("invalid", "Not valid.") });
		await expect(
			other.start({ input: input(), trigger: SCHEDULED }),
		).rejects.toThrow("Not valid.");
	});

	test("a test run is refused before it goes anywhere: the Host's start knows no trigger", async () => {
		const p = places();
		for (const projectId of ["project-hosted", "project-1"]) {
			await expect(
				p.start({
					input: {
						projectId,
						flowName: "flow",
						test: { skipped: { a: "pass" } },
					},
					trigger: SCHEDULED,
				}),
			).rejects.toThrow(TEST_RUN_FROM_EDITOR);
		}
		expect(p.started).toEqual([]);
	});

	test("a webhook's start keeps its trigger, and no role applies", async () => {
		const p = places();
		const webhook: RunTrigger = { kind: "webhook", scheduleId: "hook", at: 5 };
		await p.start({ input: input(), trigger: webhook });
		expect(p.started[0]?.trigger).toEqual(webhook);
	});
});
