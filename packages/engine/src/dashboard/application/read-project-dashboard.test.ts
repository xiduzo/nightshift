import { describe, expect, test } from "bun:test";
import { parseInstant } from "@nightshift/time";
import { NIGHT_SHIFT } from "../../contract";
import type { RunSummary } from "../../read";
import {
	inMemoryDashboardPorts,
	runSummaryOf,
} from "../adapters/out/in-memory-neighbours";
import { readProjectDashboard } from "./read-project-dashboard";

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

describe("the dashboard of one project", () => {
	test("one project counts its own runs, with its flows", async () => {
		const ports = inMemoryDashboardPorts();
		aSpace(
			ports,
			"s1",
			[
				aRun({ id: "mine", projectId: "p1" }),
				aRun({ id: "other", projectId: "p2" }),
			],
			{
				p1: "website",
				p2: "shop",
			},
		);
		const summary = await readProjectDashboard(ports)(NIGHT_SHIFT, {
			spaceId: "s1",
			projectId: "p1",
			...read,
		});
		expect(summary.lastNight?.latest.map((run) => run.id)).toEqual(["mine"]);
		expect(summary.flowHealth?.rows.map((row) => [row.name, row.runs])).toEqual(
			[
				["night", 1],
				["fix", 0],
			],
		);
		expect(summary.nights.map((range) => range.flows?.rows[0]?.runs)).toEqual([
			1, 1, 1,
		]);
		expect(summary.watch.watched).toBe(1);
	});

	test("asks the project's runs and flows for the actor, and stops on a refusal", async () => {
		const ports = inMemoryDashboardPorts();
		aSpace(ports, "s1", [], { p1: "website" });
		await readProjectDashboard(ports)(NIGHT_SHIFT, {
			spaceId: "s1",
			projectId: "p1",
			...read,
		});
		expect(ports.asked.map(({ port, request }) => [port, request])).toEqual([
			["runs.list", { spaceId: "s1", projectId: "p1" }],
			["flows.list", { spaceId: "s1", projectId: "p1" }],
		]);
		ports.refuse("runs.list", new Error("You are not a Member of this Space."));
		await expect(
			readProjectDashboard(ports)(NIGHT_SHIFT, {
				spaceId: "s1",
				projectId: "p1",
				...read,
			}),
		).rejects.toThrow("You are not a Member of this Space.");
	});
});
