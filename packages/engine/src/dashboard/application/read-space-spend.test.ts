import { describe, expect, test } from "bun:test";
import { lastDays, parseInstant } from "@nightshift/time";
import type { AnswerCost } from "../../assistant";
import { NIGHT_SHIFT } from "../../contract";
import {
	inMemoryDashboardPorts,
	runSummaryOf,
} from "../adapters/out/in-memory-neighbours";
import { readSpaceSpend } from "./read-space-spend";

const HOUR = 60 * 60 * 1000;
const NOW = parseInstant("2026-10-21T15:00:00Z");
const read = { now: NOW, timeZone: "UTC" };

const answer = (costUsd: number): AnswerCost => ({
	at: NOW - HOUR,
	agent: "builder",
	entry: null,
	projectId: null,
	spaceId: "s1",
	personId: "person-1",
	inputTokens: 10,
	outputTokens: 10,
	costUsd,
});

function spaceWithSpend() {
	const ports = inMemoryDashboardPorts();
	ports.setRuns("s1", [
		runSummaryOf({ projectId: "p1", createdAt: NOW - HOUR, costUsd: 2 }),
		runSummaryOf({ projectId: "p2", createdAt: NOW - HOUR, costUsd: 3 }),
	]);
	ports.setAnswerCosts("s1", [answer(0.5)]);
	return ports;
}

describe("the spend of a Space", () => {
	test("adds what Night Shift's own agents cost, from the start of the longest range", async () => {
		const ports = spaceWithSpend();
		const spend = await readSpaceSpend(ports)(NIGHT_SHIFT, {
			spaceId: "s1",
			...read,
		});
		const week = spend.ranges.find((range) => range.nights === 7);
		expect(week?.total).toBe(5);
		expect(week?.help.answers).toBe(1);
		expect(spend.helpThisMonth).toBe(0.5);
		expect(ports.asked.map(({ port, request }) => [port, request])).toEqual([
			["runs.list", { spaceId: "s1" }],
			[
				"answerCosts.list",
				{ spaceId: "s1", since: lastDays(90, NOW, "UTC")[0] },
			],
		]);
	});
});
