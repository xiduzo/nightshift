import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, type Database } from "@nightshift/db";
import { migrateDb } from "@nightshift/db/migrate";
import type { LandedFact, RunTrace } from "@nightshift/engine";
import { USAGE_EVENT } from "@nightshift/semconv";
import { parseInstant } from "@nightshift/time";

import { hashId } from "./anonymize";
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
		usage.note({ kind: "pull-request-opened", runId: SECRET_RUN });
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
		usage.note({ kind: "pull-request-opened", runId: SECRET_RUN });
		await usage.settled();
		const before = JSON.stringify((await usage.outbox()).waiting);
		await usage.resetId();
		usage.note({ kind: "pull-request-opened", runId: SECRET_RUN });
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
