import { expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { ATTR, RETIRED_USAGE_EVENT, USAGE_EVENT } from "@nightshift/semconv";
import { now } from "@nightshift/time";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import type { InsightsDb } from "../client";
import { migrationsFolder } from "../migrate/migrate";
import { feedback, funnel, ladders, overview, publicNumbers } from "../queries";
import { usageEvent } from "../schema";
import { attribute } from "../schema/keys";
import { ingestLogs } from "./ingest";

const ENTRY = attribute(USAGE_EVENT.installStarted, "install.entry");
const HOST = attribute(USAGE_EVENT.installStarted, "install.host");

function nowNano(): string {
	return (BigInt(now()) * 1_000_000n).toString();
}

function started(installId: string) {
	return {
		resourceLogs: [
			{
				resource: {
					attributes: [
						{ key: ATTR.serviceInstance, value: { stringValue: installId } },
						{ key: ATTR.serviceVersion, value: { stringValue: "1.2.3" } },
						{ key: ATTR.osType, value: { stringValue: "darwin" } },
						{ key: ATTR.hostArch, value: { stringValue: "arm64" } },
					],
				},
				scopeLogs: [
					{
						logRecords: [
							{
								timeUnixNano: nowNano(),
								attributes: [
									{
										key: "event.name",
										value: { stringValue: USAGE_EVENT.installStarted },
									},
									{ key: ENTRY, value: { stringValue: "desktop" } },
									{ key: HOST, value: { boolValue: false } },
								],
							},
							{
								timeUnixNano: nowNano(),
								attributes: [
									{ key: "event.name", value: { stringValue: "not-listed" } },
								],
							},
						],
					},
				],
			},
		],
	};
}

async function database(): Promise<InsightsDb> {
	const client = new PGlite();
	const db = drizzle({ client });
	await migrate(db, { migrationsFolder });
	return db as unknown as InsightsDb;
}

test("an accepted event is inserted and four installs are not enough to publish", async () => {
	const db = await database();
	const result = await ingestLogs(db, started("install-1"), { country: "NL" });
	expect(result.accepted).toBe(1);
	expect(result.refused).toBe(1);
	const rows = await db.select().from(usageEvent);
	expect(rows).toHaveLength(1);
	expect(rows[0]?.country).toBe("NL");
	expect(rows[0]?.eventName).toBe(USAGE_EVENT.installStarted);
	expect(await publicNumbers(db)).toEqual({ ready: false });
	const home = await overview(db);
	expect(home.activeInstallsThisWeek).toBe(1);
	expect(home.daysWithRunsThisWeek).toBe(0);
	expect(home.flaggedInstallIds).toEqual([]);
}, 30_000);

test("five installs publish the proof numbers and show where the funnel stops", async () => {
	const db = await database();
	for (const id of ["a", "b", "c", "d", "e"]) {
		await ingestLogs(db, started(id), { country: null });
	}
	const numbers = await publicNumbers(db);
	expect(numbers.ready).toBe(true);
	if (!numbers.ready) return;
	expect(numbers.installs).toBe(5);
	expect(numbers.usefulRate).toBeNull();
	expect(numbers.costPerUsefulResult).toBeNull();
	expect(numbers.neededYouRate).toBeNull();
	expect(numbers.shareWithTwoOrMoreAgents).toBe(0);
	const steps = await funnel(db);
	expect(steps.steps.map((step) => step.step)).toEqual([
		"install",
		"agent",
		"project",
		"checked",
		"flow",
		"schedule",
		"run",
		"finished",
		"useful",
	]);
	expect(steps.steps[0]).toMatchObject({ installs: 5, stopped: 5 });
	expect(steps.steps[1]?.installs).toBe(0);
	expect(steps.medianSecondsToFirstFinishedRun).toBeNull();
}, 30_000);

type Value = string | number | boolean | string[];

function otlpValue(field: Value): Record<string, unknown> {
	if (Array.isArray(field)) {
		return { arrayValue: { values: field.map((item) => otlpValue(item)) } };
	}
	if (typeof field === "string") return { stringValue: field };
	if (typeof field === "boolean") return { boolValue: field };
	return { doubleValue: field };
}

/** One install's events, one minute apart from `start`, in order. */
function events(
	installId: string,
	start: number,
	records: { name: string; fields?: Record<string, Value> }[],
) {
	return {
		resourceLogs: [
			{
				resource: {
					attributes: [
						{ key: ATTR.serviceInstance, value: { stringValue: installId } },
					],
				},
				scopeLogs: [
					{
						logRecords: records.map((record, index) => ({
							timeUnixNano: (
								BigInt(start + index * 60_000) * 1_000_000n
							).toString(),
							attributes: [
								{ key: "event.name", value: { stringValue: record.name } },
								...Object.entries(record.fields ?? {}).map(([key, field]) => ({
									key,
									value: otlpValue(field),
								})),
							],
						})),
					},
				],
			},
		],
	};
}

test("useful runs read old and new events as one answer per run, and the code scorer counts both", async () => {
	const db = await database();
	const RUN = USAGE_EVENT.runEnded;
	const SCORED = USAGE_EVENT.runScored;
	const OLD_USEFUL = RETIRED_USAGE_EVENT.pullRequestUseful;
	const OLD_OUTCOME = RETIRED_USAGE_EVENT.pullRequestOutcome;
	const ended = (cost: number, neededYou?: boolean) => ({
		name: RUN,
		fields: {
			[attribute(RUN, "run.trigger")]: "manual",
			[attribute(RUN, "run.status")]: "finished",
			[attribute(RUN, "end_reason")]: "finished",
			[attribute(RUN, "run.duration")]: 60,
			[attribute(RUN, "cost_usd")]: cost,
			[attribute(RUN, "flow.id")]: "0123456789abcdef",
			[attribute(RUN, "node_kinds")]: ["agent"],
			...(neededYou === undefined
				? {}
				: { [attribute(RUN, "needed_you")]: neededYou }),
		},
	});
	const scored = (runId: string, score: string, value: number) => ({
		name: SCORED,
		fields: {
			[attribute(SCORED, "run.id")]: runId,
			[attribute(SCORED, "score.name")]: score,
			[attribute(SCORED, "score.value")]: value,
		},
	});
	const start = now() - 60 * 60_000;
	const result = await ingestLogs(
		db,
		events("install-1", start, [
			{
				name: USAGE_EVENT.installStarted,
				fields: { [ENTRY]: "desktop", [HOST]: false },
			},
			// An older build: no needed_you, and the retired events.
			ended(1),
			{
				name: OLD_USEFUL,
				fields: {
					[attribute(OLD_USEFUL, "run.id")]: "run-a",
					[attribute(OLD_USEFUL, "useful")]: true,
				},
			},
			{
				name: OLD_OUTCOME,
				fields: {
					[attribute(OLD_OUTCOME, "pull_request.outcome")]: "merged",
					[attribute(OLD_OUTCOME, "pull_request.hours")]: 5,
				},
			},
			// The same install after the update: run-a's answer changes to no.
			ended(2, true),
			scored("run-a", "useful", 0),
			scored("run-b", "useful", 1),
			scored("run-b", "pr_merged", 1),
			scored("run-b", "reverted_within_7d", 1),
		]),
		{ country: null },
	);
	expect(result.refused).toBe(0);

	expect(await overview(db)).toMatchObject({
		finishedRuns: 2,
		usefulRuns: 1,
		usefulRate: 0.5,
		costPerUsefulResult: 3,
		neededYouRate: 1,
	});
	const said = await feedback(db);
	expect(said).toMatchObject({ answered: 2, useful: 1 });
	expect(said.pullRequests).toMatchObject({
		merged: 2,
		closed: 0,
		revertedWithin7Days: 1,
		revertedRate: 0.5,
	});
	expect(said.pullRequests.byInstallWeek.length).toBeGreaterThan(0);
	// The first yes, two minutes after the install, is the first useful run.
	const steps = await funnel(db);
	expect(steps.medianSecondsToFirstUsefulRun).toBe(120);
	expect(steps.medianSecondsToFirstFinishedRun).toBe(60);
}, 30_000);

test("ladders count the landings of newer builds and leave older step ends out", async () => {
	const db = await database();
	const STEP = USAGE_EVENT.stepEnded;
	const empty = await ladders(db);
	expect(empty.work).toEqual({
		landings: 0,
		installs: 0,
		costPerLanding: null,
		rungs: [],
	});
	expect(empty.choice.unsureShare).toBeNull();

	const ended = (
		kind: string,
		landing?: { ladder: string; rung: string; cost?: number; unsure?: boolean },
	) => ({
		name: STEP,
		fields: {
			[attribute(STEP, "node.kind")]: kind,
			[attribute(STEP, "step.result")]: "pass",
			[attribute(STEP, "step.visit")]: 1,
			...(landing
				? {
						[attribute(STEP, "ladder.kind")]: landing.ladder,
						[attribute(STEP, "ladder.rung")]: landing.rung,
						[attribute(STEP, "ladder.tries")]: 1,
					}
				: {}),
			...(landing?.cost === undefined
				? {}
				: { [attribute(STEP, "ladder.cost_usd")]: landing.cost }),
			...(landing?.unsure === undefined
				? {}
				: { [attribute(STEP, "ladder.unsure")]: landing.unsure }),
		},
	});
	const work = (rung: string, cost?: number) =>
		ended("agent", { ladder: "work", rung, cost });
	const choice = (rung: string, unsure: boolean, cost: number) =>
		ended("decision", { ladder: "choice", rung, cost, unsure });
	const start = now() - 60 * 60_000;
	const one = await ingestLogs(
		db,
		events("install-1", start, [
			// An older build: step ends without a rung.
			ended("agent"),
			ended("decision"),
			ended("command"),
			// A newer build. A person's answer has no known cost here.
			work("first", 0.1),
			work("first", 0.2),
			work("later", 0.9),
			work("person"),
			choice("rule", false, 0),
			choice("first", false, 0.01),
			choice("later", true, 0.05),
			choice("person", true, 0.02),
		]),
		{ country: null },
	);
	const two = await ingestLogs(
		db,
		events("install-2", start, [work("first", 0.3)]),
		{ country: null },
	);
	expect(one.refused + two.refused).toBe(0);

	const landed = await ladders(db);
	expect(landed.work.landings).toBe(5);
	expect(landed.work.installs).toBe(2);
	expect(landed.work.costPerLanding).toBeCloseTo(1.5 / 4);
	expect(landed.work.rungs.map((row) => row.rung)).toEqual([
		"first",
		"later",
		"person",
	]);
	expect(landed.work.rungs[0]).toMatchObject({
		landings: 3,
		share: 0.6,
		installs: 2,
	});
	expect(landed.work.rungs[0]?.costPerLanding).toBeCloseTo(0.2);
	expect(landed.work.rungs[2]).toMatchObject({
		landings: 1,
		costPerLanding: null,
	});
	expect(landed.choice).toMatchObject({
		landings: 4,
		installs: 1,
		decided: 3,
		unsure: 2,
	});
	expect(landed.choice.unsureShare).toBeCloseTo(2 / 3);
	expect(landed.choice.rungs.map((row) => [row.rung, row.share])).toEqual([
		["rule", 0.25],
		["first", 0.25],
		["later", 0.25],
		["person", 0.25],
	]);
}, 30_000);
