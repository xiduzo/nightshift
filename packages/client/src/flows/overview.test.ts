import { describe, expect, test } from "bun:test";

import type { FlowHealthRow } from "../dashboard";
import type { ScheduleSummary } from "../schedules";
import { flowOverviews } from "./overview";
import type { FlowListItem } from "./types";

const flow = (
	name: string,
	extra: Partial<FlowListItem> = {},
): FlowListItem => ({
	name,
	path: name,
	description: null,
	nodeCount: 3,
	errorCount: 0,
	inputs: [],
	callers: [],
	devices: { names: [], ids: [] },
	nodeTypes: [],
	gateCount: 0,
	...extra,
});

/** The fields a schedule needs here. The rest does not matter to the overview. */
const schedule = (extra: Partial<ScheduleSummary>): ScheduleSummary =>
	({
		id: "s",
		flow: "nightly",
		cron: "0 22 * * *",
		enabled: true,
		nextAt: 1_000,
		...extra,
	}) as ScheduleSummary;

const health = (
	name: string,
	statuses: FlowHealthRow["lastRuns"][number]["status"][],
): FlowHealthRow =>
	({
		name,
		lastRuns: statuses.map((status, index) => ({
			runId: `run-${index}`,
			status,
			startedAt: 1_000 - index,
		})),
	}) as FlowHealthRow;

describe("flowOverviews", () => {
	test("lists every way a flow starts: schedules on first by next start, paused ones, webhooks, then calling flows", () => {
		const [overview] = flowOverviews(
			[flow("nightly", { callers: ["night", "night-2"] })],
			[
				schedule({ id: "paused", enabled: false, nextAt: 10 }),
				schedule({ id: "late", nextAt: 3_000 }),
				schedule({
					id: "hook",
					cron: undefined,
					nextAt: null,
					webhook: {} as ScheduleSummary["webhook"],
				}),
				schedule({ id: "soon", nextAt: 2_000 }),
				schedule({ id: "other", flow: "another" }),
			],
			[],
		);
		expect(
			overview?.starts.map((start) =>
				start.kind === "subflow" ? start.caller : start.schedule.id,
			),
		).toEqual(["soon", "late", "hook", "paused", "night", "night-2"]);
		expect(overview?.starts.map((start) => start.kind)).toEqual([
			"schedule",
			"schedule",
			"webhook",
			"schedule",
			"subflow",
			"subflow",
		]);
		expect(overview?.startsOnItsOwn).toBe(true);
	});

	test("a flow with only paused schedules does not start on its own", () => {
		const [overview] = flowOverviews(
			[flow("nightly")],
			[schedule({ enabled: false })],
			[],
		);
		expect(overview?.startsOnItsOwn).toBe(false);
		expect(overview?.starts).toHaveLength(1);
	});

	test("counts the finished runs among the last runs that ended", () => {
		const [overview] = flowOverviews(
			[flow("nightly")],
			[],
			[
				health("nightly", [
					"running",
					"finished",
					"failed",
					"finished",
					"stopped",
				]),
			],
		);
		expect(overview).toMatchObject({ ended: 4, finished: 2 });
		expect(overview?.lastRuns).toHaveLength(5);
	});

	test("a flow that never ran has no last runs and no problem", () => {
		const [overview] = flowOverviews([flow("nightly")], [], []);
		expect(overview).toMatchObject({
			lastRuns: [],
			ended: 0,
			finished: 0,
			problem: null,
		});
	});

	test("a flow that does not load, then one with errors, then a failed last run, needs a look", () => {
		expect(
			flowOverviews(
				[
					flow("broken", { nodeCount: null, errorCount: 1 }),
					flow("errors", { errorCount: 2 }),
					flow("failing"),
					flow("fine"),
				],
				[],
				[
					health("failing", ["failed", "finished"]),
					health("fine", ["finished", "failed"]),
				],
			).map((overview) => overview.problem),
		).toEqual([
			{ kind: "does-not-load" },
			{ kind: "errors", count: 2 },
			{ kind: "last-run-failed" },
			null,
		]);
	});
});
