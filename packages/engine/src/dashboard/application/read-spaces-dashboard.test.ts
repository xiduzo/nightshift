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
		aSpace(
			ports,
			"s1",
			[aRun({ id: "a", projectId: "p1", createdAt: NOW - HOUR / 2 })],
			{
				p1: "website",
			},
		);
		aSpace(ports, "s2", [aRun({ id: "b", projectId: "p2" })], {
			p2: "shop",
		});
		aSpace(ports, "s3", [aRun({ id: "c", projectId: "p3" })], { p3: "notes" });
		const summary = await readSpacesDashboard(ports)(NIGHT_SHIFT, {
			spaceIds: ["s1", "s2"],
			...read,
		});
		expect(summary.lastNight?.latest.map((run) => [run.id, run.group])).toEqual(
			[
				["a", "website"],
				["b", "shop"],
			],
		);
		expect(summary.watch.watched).toBe(2);
		expect(summary.flowHealth).toBeNull();
	});
});
