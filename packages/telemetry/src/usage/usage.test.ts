import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, type Database } from "@nightshift/db";
import { migrateDb } from "@nightshift/db/migrate";
import { type LandedFact, RUNGS, type RunTrace } from "@nightshift/engine";
import { NODE_TYPE_LABEL, starterList } from "@nightshift/flows";
import {
	RETIRED_USAGE_EVENT,
	USAGE_EVENT,
	usageEventSchema,
} from "@nightshift/semconv";
import { parseInstant } from "@nightshift/time";

import { hashId } from "./anonymize";
import { momentEvent } from "./events";
import { attr, known } from "./fields";
import type { WaitingEvent } from "./outbox";
import {
	keepEvent,
	USAGE_MAX_AGE_MS,
	USAGE_MAX_EVENTS,
	waitingEvents,
} from "./outbox";
import { parseUsageEvent, sampleUsageEvent } from "./parse";
import { createUsage } from "./record";

const SECRET_FLOW = "Nightly Review";
const SECRET_PATH = "/tmp/secret-repo";
const SECRET_EMAIL = "ada@example.com";
const SECRET_RUN = "run-secret-id";

async function openDb(): Promise<{ db: Database; close(): Promise<void> }> {
	const dir = await mkdtemp(join(tmpdir(), "nightshift-usage-"));
	const db = createDb({ DATABASE_URL: `file:${join(dir, "usage.db")}` });
	await migrateDb(db);
	return { db, close: () => rm(dir, { recursive: true, force: true }) };
}

function switches(usage: boolean, usageSeen: boolean) {
	return { current: () => ({ usage, usageSeen }) };
}

const saved = new Map<string, string | undefined>();
function setEnv(values: Record<string, string | undefined>) {
	for (const [key, value] of Object.entries(values)) {
		if (!saved.has(key)) saved.set(key, process.env[key]);
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
}
afterEach(() => {
	for (const [key, value] of saved) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	saved.clear();
});

function trace(): RunTrace {
	return {
		runId: SECRET_RUN,
		projectId: "project-1",
		flowName: SECRET_FLOW,
		trigger: "manual",
		startedAt: 0,
		ends: [
			{
				seq: 1,
				openedAt: 0,
				at: 65_000,
				status: "finished",
				reason: `see ${SECRET_EMAIL} at ${SECRET_PATH}`,
				first: true,
				neededYou: false,
			},
		],
		steps: [
			{
				id: "step-1",
				nodeId: "Write the email",
				nodeType: "agent",
				visit: 1,
				parentStepId: null,
				deviceId: null,
				startedAt: 0,
				ends: [
					{
						seq: 2,
						openedAt: 0,
						at: 10_000,
						outcome: "pass",
						error: `${SECRET_EMAIL} ${SECRET_PATH}`,
						costUsd: 1.234,
						costBasis: "estimated",
						first: true,
						sessions: [
							{
								id: "session-1",
								harness: "claude-code",
								model: "claude-sonnet-4-5",
								startedAt: 0,
								endedAt: 10_000,
								costUsd: 1.234,
								costBasis: "estimated",
								tokens: { input: 3, output: 4, cacheRead: 1, cacheWrite: 2 },
							},
						],
						gateWaits: [],
						sleeps: [],
						knowledge: { searches: 0, reads: 0 },
					},
				],
			},
		],
		neededYou: [],
	};
}

test("a flow name, a path, an email and a raw run id never appear in the stored JSON", async () => {
	const { db, close } = await openDb();
	try {
		const usage = createUsage({
			db,
			settings: switches(true, true),
			policy: async () => true,
			now: () => parseInstant("2026-06-01T12:00:30Z"),
		});
		const facts: LandedFact[] = [
			{
				kind: "run-ended",
				spaceId: "space-1",
				runId: SECRET_RUN,
				seq: 1,
				changes: "summary",
				status: "finished",
			},
			{
				kind: "step-ended",
				spaceId: "space-1",
				runId: SECRET_RUN,
				seq: 2,
				changes: "summary",
				stepId: "step-1",
			},
		];
		await usage.take(facts, async () => trace());
		usage.note({
			kind: "run-scored",
			runId: SECRET_RUN,
			score: "useful",
			value: 1,
		});
		await usage.settled();
		const waiting = (await usage.outbox()).waiting;
		expect(waiting).toHaveLength(3);
		const body = JSON.stringify(waiting);
		expect(body).not.toContain(SECRET_FLOW);
		expect(body).not.toContain(SECRET_PATH);
		expect(body).not.toContain(SECRET_EMAIL);
		expect(body).not.toContain(SECRET_RUN);
		expect(body).not.toContain("Write the email");
		expect(body).not.toContain("claude-sonnet-4-5");
		await usage.stop();
	} finally {
		await close();
	}
});

test("a run that ends guard.turns does not emit _OTHER for that reason", async () => {
	const { db, close } = await openDb();
	try {
		const usage = createUsage({
			db,
			settings: switches(true, true),
			policy: async () => true,
		});
		const ended = trace();
		const first = ended.ends[0];
		if (!first) throw new Error("missing end");
		ended.ends[0] = {
			...first,
			status: "failed",
			reason: "The agent reached its limit of 4 turns, so the step stopped.",
			endReason: "guard.turns",
		};
		const facts: LandedFact[] = [
			{
				kind: "run-ended",
				spaceId: "space-1",
				runId: SECRET_RUN,
				seq: 1,
				changes: "summary",
				status: "failed",
			},
		];
		await usage.take(facts, async () => ended);
		await usage.settled();
		const body = JSON.stringify((await usage.outbox()).waiting);
		expect(body).toContain("guard.turns");
		expect(body).not.toContain("_OTHER");
		await usage.stop();
	} finally {
		await close();
	}
});

test("a run's end says whether a person stepped in", async () => {
	const { db, close } = await openDb();
	try {
		const usage = createUsage({
			db,
			settings: switches(true, true),
			policy: async () => true,
		});
		const ended = (seq: number): LandedFact => ({
			kind: "run-ended",
			spaceId: "space-1",
			runId: SECRET_RUN,
			seq,
			changes: "summary",
			status: "finished",
		});
		await usage.take([ended(1)], async () => trace());
		const needed = trace();
		const end = needed.ends[0];
		if (!end) throw new Error("missing end");
		needed.ends[0] = { ...end, neededYou: true };
		await usage.take([ended(1)], async () => needed);
		await usage.settled();
		const name = USAGE_EVENT.runEnded;
		const sent = (await usage.outbox()).waiting as Record<string, unknown>[];
		expect(sent.map((event) => event[attr(name, "run.needed_you")])).toEqual([
			false,
			true,
		]);
		await usage.stop();
	} finally {
		await close();
	}
});

test("a landing leaves with its ladder, rung, tries and cost, and a tier label and a metric name never appear in the stored JSON", async () => {
	const SECRET_TIER = "Careful Reviewer";
	const SECRET_METRIC = "leads_found";
	const { db, close } = await openDb();
	try {
		const usage = createUsage({
			db,
			settings: switches(true, true),
			policy: async () => true,
		});
		const landed = trace();
		const step = landed.steps[0];
		const end = step?.ends[0];
		if (!step || !end) throw new Error("missing step");
		landed.steps[0] = {
			...step,
			nodeType: "decision",
			rung: "later",
			ends: [
				{
					...end,
					landing: {
						ladder: "choice",
						rung: "later",
						tier: SECRET_TIER,
						tries: 2,
						costUsd: 0.0349,
						unsure: true,
					},
				},
			],
		};
		const facts: LandedFact[] = [
			{
				kind: "step-ended",
				spaceId: "space-1",
				runId: SECRET_RUN,
				seq: 2,
				changes: "summary",
				stepId: "step-1",
			},
			{
				kind: "scored",
				spaceId: "space-1",
				runId: SECRET_RUN,
				seq: 3,
				changes: "detail",
				score: SECRET_METRIC,
				value: 12,
				label: null,
				stepId: "step-1",
				by: null,
			},
		];
		await usage.take(facts, async () => landed);
		await usage.settled();
		const waiting = (await usage.outbox()).waiting as Record<string, unknown>[];
		expect(waiting).toHaveLength(1);
		const name = USAGE_EVENT.stepEnded;
		const [event] = waiting;
		expect(event?.[attr(name, "ladder.kind")]).toBe("choice");
		expect(event?.[attr(name, "ladder.rung")]).toBe("later");
		expect(event?.[attr(name, "ladder.tries")]).toBe(2);
		expect(event?.[attr(name, "ladder.unsure")]).toBe(true);
		expect(event?.[attr(name, "ladder.cost_usd")]).toBe(0.03);
		const body = JSON.stringify(waiting);
		expect(body).not.toContain(SECRET_TIER);
		expect(body).not.toContain(SECRET_METRIC);
		await usage.stop();
	} finally {
		await close();
	}
});

test("a step that did not land, or landed on the work ladder, sends no unsure", async () => {
	const { db, close } = await openDb();
	try {
		const usage = createUsage({
			db,
			settings: switches(true, true),
			policy: async () => true,
		});
		const fact = (seq: number, stepId: string): LandedFact => ({
			kind: "step-ended",
			spaceId: "space-1",
			runId: SECRET_RUN,
			seq,
			changes: "summary",
			stepId,
		});
		const work = trace();
		const step = work.steps[0];
		const end = step?.ends[0];
		if (!step || !end) throw new Error("missing step");
		work.steps = [
			{ ...step, id: "plain" },
			{
				...step,
				id: "landed",
				rung: "first",
				ends: [
					{
						...end,
						seq: 3,
						landing: {
							ladder: "work",
							rung: "first",
							tier: null,
							tries: 1,
							costUsd: null,
						},
					},
				],
			},
		];
		await usage.take([fact(2, "plain"), fact(3, "landed")], async () => work);
		await usage.settled();
		const name = USAGE_EVENT.stepEnded;
		const [plain, landed] = (await usage.outbox()).waiting as Record<
			string,
			unknown
		>[];
		for (const key of [
			"ladder.kind",
			"ladder.rung",
			"ladder.tries",
			"ladder.unsure",
			"ladder.cost_usd",
		]) {
			expect(plain?.[attr(name, key)]).toBeUndefined();
		}
		expect(landed?.[attr(name, "ladder.kind")]).toBe("work");
		expect(landed?.[attr(name, "ladder.rung")]).toBe("first");
		expect(landed?.[attr(name, "ladder.tries")]).toBe(1);
		// Part of its cost is not known: no cost, never a part of it.
		expect(landed?.[attr(name, "ladder.cost_usd")]).toBeUndefined();
		expect(landed?.[attr(name, "ladder.unsure")]).toBeUndefined();
		await usage.stop();
	} finally {
		await close();
	}
});

test("every rung of the engine is a member of the closed list", () => {
	const missing = RUNGS.filter(
		(rung) => known(USAGE_EVENT.stepEnded, "ladder.rung", rung) !== rung,
	);
	expect(missing).toEqual([]);
});

test("an HMAC is stable for one key and changes after the id is reset", async () => {
	expect(hashId("key", SECRET_RUN)).toBe(hashId("key", SECRET_RUN));
	expect(hashId("key", SECRET_RUN)).not.toBe(hashId("other", SECRET_RUN));
	expect(hashId("key", SECRET_RUN)).toHaveLength(16);

	const { db, close } = await openDb();
	try {
		const usage = createUsage({
			db,
			settings: switches(true, true),
			policy: async () => true,
		});
		usage.note({
			kind: "run-scored",
			runId: SECRET_RUN,
			score: "useful",
			value: 1,
		});
		await usage.settled();
		const before = JSON.stringify((await usage.outbox()).waiting);
		await usage.resetId();
		usage.note({
			kind: "run-scored",
			runId: SECRET_RUN,
			score: "useful",
			value: 1,
		});
		await usage.settled();
		const after = (await usage.outbox()).waiting;
		expect(after).toHaveLength(2);
		expect(JSON.stringify(after[0])).toBe(before.slice(1, -1));
		expect(JSON.stringify(after[1])).not.toBe(JSON.stringify(after[0]));
		expect(JSON.stringify(after)).not.toContain(SECRET_RUN);
		await usage.stop();
	} finally {
		await close();
	}
});

test("a knowledge document's size leaves as a hash and whole kilobytes", async () => {
	const { db, close } = await openDb();
	try {
		const usage = createUsage({
			db,
			settings: switches(true, true),
			policy: async () => true,
		});
		usage.note({
			kind: "knowledge-document-measured",
			projectId: SECRET_RUN,
			bytes: 7_679_009,
		});
		await usage.settled();
		const [event] = (await usage.outbox()).waiting as Record<string, unknown>[];
		expect(event?.name).toBe(USAGE_EVENT.knowledgeDocumentMeasured);
		const name = USAGE_EVENT.knowledgeDocumentMeasured;
		expect(event?.[attr(name, "project.id")]).toHaveLength(16);
		expect(event?.[attr(name, "document.kilobytes")]).toBe(7_680);
		expect(JSON.stringify(event)).not.toContain(SECRET_RUN);
		await usage.stop();
	} finally {
		await close();
	}
});

test("the outbox drops events past 7 days and past 5,000", async () => {
	const { db, close } = await openDb();
	try {
		const event = parseUsageEvent(sampleUsageEvent());
		const start = parseInstant("2026-01-01T00:00:00Z");
		await keepEvent(db, event, start, start + USAGE_MAX_AGE_MS);
		expect(await waitingEvents(db)).toHaveLength(1);
		await keepEvent(db, event, start, start + USAGE_MAX_AGE_MS + 60_000);
		await keepEvent(
			db,
			event,
			start + USAGE_MAX_AGE_MS + 60_000,
			start + USAGE_MAX_AGE_MS + 60_000,
		);
		const aged = await waitingEvents(db);
		expect(aged.every((item) => item.at >= start + 60_000)).toBe(true);
		expect(aged.length).toBeGreaterThan(0);

		const fresh = parseInstant("2026-06-01T00:00:00Z");
		for (let i = 0; i < USAGE_MAX_EVENTS + 1; i++) {
			await keepEvent(db, event, fresh + i, fresh + USAGE_MAX_EVENTS);
		}
		expect(await waitingEvents(db)).toHaveLength(USAGE_MAX_EVENTS);
	} finally {
		await close();
	}
});

test("a bad attribute fails validation and is not stored", async () => {
	const bad = { name: USAGE_EVENT.scheduleFired, extra: true };
	expect(() => parseUsageEvent(bad)).toThrow();
	const { db, close } = await openDb();
	try {
		expect(await keepEvent(db, bad, 0, 0)).toBe(false);
		expect(await waitingEvents(db)).toEqual([]);
	} finally {
		await close();
	}
});

test("nothing is sent while usage is off, a Space is off, or an environment lock is set", async () => {
	const cases: {
		usage: boolean;
		seen: boolean;
		policy: boolean;
		env?: Record<string, string>;
	}[] = [
		{ usage: false, seen: true, policy: true },
		{ usage: true, seen: true, policy: false },
		{ usage: true, seen: true, policy: true, env: { DO_NOT_TRACK: "1" } },
		{
			usage: true,
			seen: true,
			policy: true,
			env: { OTEL_SDK_DISABLED: "TRUE" },
		},
		{ usage: true, seen: false, policy: true },
	];
	for (const item of cases) {
		setEnv({
			NIGHTSHIFT_USAGE: undefined,
			DO_NOT_TRACK: undefined,
			OTEL_SDK_DISABLED: undefined,
			...item.env,
		});
		const { db, close } = await openDb();
		const sent: WaitingEvent[][] = [];
		try {
			const usage = createUsage({
				db,
				settings: switches(item.usage, item.seen),
				policy: async () => item.policy,
				transport: {
					send: async (events) => {
						sent.push(events);
					},
				},
			});
			usage.note({ kind: "schedule-fired" });
			await usage.stop();
			expect(sent).toEqual([]);
			const waiting = (await usage.outbox()).waiting;
			expect(waiting).toHaveLength(
				item.usage && item.policy && !item.env ? 1 : 0,
			);
		} finally {
			await close();
		}
	}
});

test("an explicit usage env of on may send before the notice is seen", async () => {
	setEnv({
		NIGHTSHIFT_USAGE: "on",
		DO_NOT_TRACK: undefined,
		OTEL_SDK_DISABLED: undefined,
	});
	const { db, close } = await openDb();
	const sent: WaitingEvent[][] = [];
	try {
		const usage = createUsage({
			db,
			settings: switches(true, false),
			policy: async () => true,
			transport: {
				send: async (events) => {
					sent.push(events);
				},
			},
		});
		usage.note({ kind: "schedule-fired" });
		await usage.settled();
		expect((await usage.outbox()).waiting.length).toBe(1);
		await usage.stop();
		expect(sent).toHaveLength(1);
		expect(JSON.stringify(sent)).not.toContain("schedule-fired");
		const names = sent[0]?.map((item) => item.event.name);
		expect(names).toEqual([USAGE_EVENT.scheduleFired]);
	} finally {
		await close();
	}
});

const PLATFORM = { os: "darwin", arch: "arm64", version: "1.0.0" };

test("a useful answer leaves as run.scored, under one name for old and new logs", () => {
	const name = USAGE_EVENT.runScored;
	const answer = momentEvent(
		{ kind: "run-scored", runId: SECRET_RUN, score: "pr_useful", value: 0 },
		"key",
		PLATFORM,
	);
	expect(answer).toEqual({
		name,
		[attr(name, "run.id")]: hashId("key", SECRET_RUN),
		[attr(name, "score.name")]: "useful",
		[attr(name, "score.value")]: 0,
	});
	const merged = momentEvent(
		{
			kind: "run-scored",
			runId: SECRET_RUN,
			score: "pr_merged",
			value: 1,
			elapsedMs: 90 * 60_000 + 400,
		},
		"key",
		PLATFORM,
	);
	expect(merged?.[attr(name, "score.name")]).toBe("pr_merged");
	expect(merged?.[attr(name, "score.hours")]).toBe(1.5);
	const own = momentEvent(
		{
			kind: "run-scored",
			runId: SECRET_RUN,
			score: "replicated",
			value: 0.333,
		},
		"key",
		PLATFORM,
	);
	expect(own?.[attr(name, "score.name")]).toBe("_OTHER");
	expect(own?.[attr(name, "score.value")]).toBe(0.33);
	expect(JSON.stringify([answer, merged, own])).not.toContain(SECRET_RUN);
});

test("a flow from a starter the registry does not list sends _OTHER, not nothing", () => {
	const name = USAGE_EVENT.flowCreated;
	const event = momentEvent(
		{ kind: "flow-created", from: "starter", starter: "a-newer-starter" },
		"key",
		PLATFORM,
	);
	expect(event?.[attr(name, "flow.starter")]).toBe("_OTHER");
});

test("every starter and every node type is a member of its closed list", () => {
	const starters = starterList()
		.map((starter) => starter.name)
		.filter(
			(starter) =>
				known(USAGE_EVENT.flowCreated, "flow.starter", starter) !== starter,
		);
	expect(starters).toEqual([]);
	const kinds = Object.keys(NODE_TYPE_LABEL).filter(
		(kind) => known(USAGE_EVENT.stepEnded, "node.kind", kind) !== kind,
	);
	expect(kinds).toEqual([]);
});

test("every usage event in the registry is sent or retired, never both", () => {
	const sent: string[] = Object.values(USAGE_EVENT);
	const retired: string[] = Object.values(RETIRED_USAGE_EVENT);
	expect(sent.filter((name) => retired.includes(name))).toEqual([]);
	expect([...sent, ...retired].sort()).toEqual(
		Object.keys(usageEventSchema).sort(),
	);
});
