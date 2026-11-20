import { describe, expect, test } from "bun:test";
import { parseInstant } from "@nightshift/time";
import { NIGHT_SHIFT } from "../../contract";
import type { RunSummary } from "../../read";
import {
	inMemoryDashboardPorts,
	runSummaryOf,
} from "../adapters/out/in-memory-neighbours";
import { readSpacesDashboard } from "./read-spaces-dashboard";

const HOUR = 60 * 60 * 1000;
const NOW = parseInstant("2026-10-21T15:00:00Z");
const read = { now: NOW, timeZone: "UTC" };

const aRun = (fields: Partial<RunSummary> = {}) =>
	runSummaryOf({ createdAt: NOW - HOUR, ...fields });

/** One Space's runs and projects, with the flows `night` and `fix` in each project. */
function aSpace(
	ports: ReturnType<typeof inMemoryDashboardPorts>,
	spaceId: string,
	runs: RunSummary[],
	projects: Record<string, string>,
) {
	ports.setRuns(spaceId, runs);
	ports.setProjects(
		spaceId,
		Object.entries(projects).map(([id, name]) => ({ id, name })),
	);
	for (const id of Object.keys(projects)) ports.setFlows(id, ["night", "fix"]);
}

describe("the dashboard of Spaces", () => {
	test("every Space's runs count, grouped by the project's name", async () => {
		const ports = inMemoryDashboardPorts();
		aSpace(ports, "s1", [aRun({ projectId: "p1", costUsd: 2 })], {
			p1: "website",
		});
		aSpace(ports, "s2", [aRun({ projectId: "p2", costUsd: 1 })], {
			p2: "shop",
		});
		const summary = await readSpacesDashboard(ports)(NIGHT_SHIFT, {
			spaceIds: ["s1", "s2"],
			...read,
		});
		expect(summary.cards.lastDay.runs).toBe(2);
		const days = summary.nights.find((range) => range.nights === 30);
		expect(days?.spend.groups.map((group) => group.label)).toEqual([
			"website",
			"shop",
		]);
	});

	test("says the days Flow health covers: one of its ranges of days", async () => {
		const ports = inMemoryDashboardPorts();
		aSpace(ports, "s1", [aRun({ projectId: "p1" })], { p1: "website" });
		const summary = await readSpacesDashboard(ports)(NIGHT_SHIFT, {
			spaceIds: ["s1"],
			...read,
		});
		expect(summary.healthNights).toBe(30);
		expect(summary.nights.map((range) => range.nights)).toContain(
			summary.healthNights,
		);
	});
});
