import { describe, expect, test } from "bun:test";
import { parseInstant } from "@nightshift/time";
import { NIGHT_SHIFT } from "../../contract";
import {
	inMemoryDashboardPorts,
	runSummaryOf,
} from "../adapters/out/in-memory-neighbours";
import { readFlowHealth } from "./read-flow-health";

const HOUR = 60 * 60 * 1000;
const NOW = parseInstant("2026-10-21T15:00:00Z");

describe("the health of one flow", () => {
	test("reads the project's runs for the actor, and counts the flow's own", async () => {
		const ports = inMemoryDashboardPorts();
		ports.setRuns("s1", [
			runSummaryOf({ projectId: "p1", createdAt: NOW - HOUR }),
			runSummaryOf({ projectId: "p1", createdAt: NOW - HOUR, flowName: "fix" }),
			runSummaryOf({ projectId: "p2", createdAt: NOW - HOUR }),
		]);
		const health = await readFlowHealth(ports)(NIGHT_SHIFT, {
			spaceId: "s1",
			projectId: "p1",
			flowName: "night",
			now: NOW,
			timeZone: "UTC",
		});
		expect(health.name).toBe("night");
		expect(health.ranges.find((range) => range.nights === 7)?.runs).toBe(1);
		expect(ports.asked.map(({ request }) => request)).toEqual([
			{ spaceId: "s1", projectId: "p1" },
		]);
	});
});
