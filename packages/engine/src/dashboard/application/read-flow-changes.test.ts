import { describe, expect, test } from "bun:test";
import { parseInstant } from "@nightshift/time";
import { NIGHT_SHIFT } from "../../contract";
import type { RunDetail } from "../../read";
import {
	inMemoryDashboardPorts,
	runSummaryOf,
} from "../adapters/out/in-memory-neighbours";
import { readFlowChanges } from "./read-flow-changes";

const HOUR = 60 * 60 * 1000;
const NOW = parseInstant("2026-10-21T15:00:00Z");
const request = {
	spaceId: "s1",
	projectId: "p1",
	name: "night",
	nights: 7 as const,
	now: NOW,
	timeZone: "UTC",
};

/** An ended run of `night`, `hoursAgo` hours ago, with no steps as its detail. */
const ended = (hoursAgo: number) =>
	({
		...runSummaryOf({
			result: "done",
			createdAt: NOW - hoursAgo * HOUR,
			endedAt: NOW - hoursAgo * HOUR + 60_000,
			neededYou: [],
		}),
		steps: [],
	}) as unknown as RunDetail;

describe("before and after for one flow", () => {
	test("reads the runs, the revisions and the detail of each recent run, for the actor", async () => {
		const ports = inMemoryDashboardPorts();
		const runs = [ended(2), ended(1)];
		ports.setRuns("s1", runs);
		const changes = await readFlowChanges(ports)(NIGHT_SHIFT, request);
		expect(changes.read).toBe(2);
		expect(changes.runs.length).toBe(2);
		expect(ports.asked.map(({ port, request }) => [port, request])).toEqual([
			["runs.list", { spaceId: "s1", projectId: "p1" }],
			["flows.revisions", { spaceId: "s1", projectId: "p1", name: "night" }],
			["runs.get", { spaceId: "s1", runId: runs[0]?.id }],
			["runs.get", { spaceId: "s1", runId: runs[1]?.id }],
		]);
	});

	test("a flow whose revisions cannot be read has no changes, and a run it cannot open is left out", async () => {
		const ports = inMemoryDashboardPorts();
		ports.setRuns("s1", [ended(2), ended(1)]);
		ports.refuse("flows.revisions", new Error("The flow is gone."));
		ports.refuse("runs.get", new Error("No such run."));
		const changes = await readFlowChanges(ports)(NIGHT_SHIFT, request);
		expect(changes.changes).toEqual([]);
		expect(changes.read).toBe(0);
		expect(changes.runs.length).toBe(2);
	});
});
