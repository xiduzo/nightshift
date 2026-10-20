import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "@nightshift/db";
import { event, project, run } from "@nightshift/db/schema";
import { asc, eq } from "drizzle-orm";

import { deriveRunStatus } from "../read/derive-run";
import { createSandbox, type Sandbox } from "../testing/test-support";
import { type EventInput, type LoggedEvent, parseEventRow } from "./events";
import { createRunLog } from "./run-log";

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
	// The runs the tests append to: an event takes its run's Space.
	await sandbox.db
		.insert(project)
		.values({ id: "p", spaceId: sandbox.spaceId, name: "p" });
	await sandbox.db.insert(run).values(
		["r0", "r1", "r2", "open", "a", "b", "c"].map((id) => ({
			id,
			spaceId: sandbox.spaceId,
			projectId: "p",
			flow: "{}",
			title: id,
			worktreePath: "/w",
			branch: "b",
			baseRef: "main",
			walkerId: sandbox.deviceId,
		})),
	);
});
afterEach(async () => {
	await sandbox.cleanup();
});

async function fromDb(runId: string): Promise<LoggedEvent[]> {
	const rows = await sandbox.db
		.select()
		.from(event)
		.where(eq(event.runId, runId))
		.orderBy(asc(event.seq));
	return rows.map(parseEventRow);
}

/** `db`, but every select returns its rows only once `held` resolves. */
function heldReads(db: Database, held: Promise<void>): Database {
	const hold = (target: object): object =>
		new Proxy(target, {
			get(t, key) {
				const value = Reflect.get(t, key, t);
				if (typeof value !== "function") return value;
				if (key === "then") {
					return (
						onRows: (rows: unknown) => unknown,
						onError: (error: unknown) => unknown,
					) =>
						value
							.call(t, async (rows: unknown) => {
								await held;
								return rows;
							})
							.then(onRows, onError);
				}
				return (...args: unknown[]) => {
					const result = value.apply(t, args);
					return result && typeof result === "object" ? hold(result) : result;
				};
			},
		});
	return new Proxy(db, {
		get(t, key) {
			const value = Reflect.get(t, key, t);
			return key === "select"
				? (...args: unknown[]) => hold(value.apply(t, args))
				: value;
		},
	});
}

const started = (runId: string): EventInput<"RunStarted"> => ({
	type: "RunStarted",
	runId,
	payload: { projectId: "p", flowName: "f", title: "t", start: "a" },
});
const ended = (runId: string): EventInput<"RunEnded"> => ({
	type: "RunEnded",
	runId,
	payload: { status: "finished", reason: null },
});
const edge = (runId: string, n: number): EventInput<"EdgeTaken"> => ({
	type: "EdgeTaken",
	runId,
	payload: { edgeId: `e${n}`, from: "a", to: "b", outcome: "pass" },
});

describe("run log", () => {
	test("an append is kept as committed, with its seq and time", async () => {
		const log = createRunLog(sandbox.db);
		await log.append(started("r1"));
		expect(await log.events("r1")).toEqual(await fromDb("r1"));
		const logged = await log.append(edge("r1", 1));
		expect(logged.seq).toBeGreaterThan(0);
		expect(await log.events("r1")).toEqual(await fromDb("r1"));
		expect((await log.events("r1")).at(-1)).toEqual(logged);
	});

	test("a read is a copy: a later append does not change it", async () => {
		const log = createRunLog(sandbox.db);
		await log.append(started("r1"));
		const before = await log.events("r1");
		await log.append(edge("r1", 1));
		expect(before).toHaveLength(1);
		expect(await log.events("r1")).toHaveLength(2);
	});

	test("concurrent appends to one run keep seq order", async () => {
		const log = createRunLog(sandbox.db);
		await log.append(started("r1"));
		await log.events("r1");
		await Promise.all(
			Array.from({ length: 50 }, (_, n) => log.append(edge("r1", n))),
		);
		const events = await log.events("r1");
		expect(events).toEqual(await fromDb("r1"));
		expect(events.map((e) => e.seq)).toEqual(
			events.map((e) => e.seq).toSorted((a, b) => a - b),
		);
	});

	test("an append that lands while a run's log is read is not lost", async () => {
		// The read takes its snapshot at once but returns only when `release` runs.
		let release = () => {};
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		const log = createRunLog(heldReads(sandbox.db, held), {
			walkerId: sandbox.deviceId,
		});
		await log.append(started("r1"));
		const read = log.events("r1");
		await log.append(edge("r1", 1));
		release();
		expect(await read).toEqual(await fromDb("r1"));
		expect(await read).toHaveLength(2);
	});

	test("derive does not keep a value read before an append landed", async () => {
		let release = () => {};
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		const log = createRunLog(heldReads(sandbox.db, held), {
			walkerId: sandbox.deviceId,
		});
		const count = (events: readonly LoggedEvent[]) => events.length;
		await log.append(started("r1"));
		const counted = log.derive(["r1"], count);
		await log.append(edge("r1", 1));
		release();
		expect((await counted).get("r1")).toBe(2);
		expect((await log.derive(["r1"], count)).get("r1")).toBe(2);
	});

	test("an append that throws leaves the log as it was", async () => {
		const log = createRunLog(sandbox.db);
		await log.append(started("r1"));
		await log.events("r1");
		await sandbox.db.$client.execute(
			"CREATE TRIGGER refuse BEFORE INSERT ON event WHEN NEW.type = 'EdgeTaken' BEGIN SELECT RAISE(ABORT, 'refused'); END",
		);
		const statuses = await log.derive(["r1"], deriveRunStatus);
		await expect(log.append(edge("r1", 1))).rejects.toThrow();
		expect(await log.events("r1")).toEqual(await fromDb("r1"));
		expect(await log.events("r1")).toHaveLength(1);
		expect(await log.derive(["r1"], deriveRunStatus)).toEqual(statuses);
	});

	test("ended runs are dropped least recently used first; open runs stay", async () => {
		const log = createRunLog(sandbox.db, { maxIdleEvents: 4 });
		await log.append(started("open"));
		for (const runId of ["a", "b", "c"]) {
			await log.append(started(runId));
			await log.append(ended(runId));
		}
		await log.events("open");
		await log.events("a");
		await log.events("b");
		expect([...log.cached().keys()]).toEqual(["open", "a", "b"]);
		await log.events("a");
		await log.events("c");
		expect([...log.cached().keys()]).toEqual(["open", "a", "c"]);

		// A dropped run reads from the database again.
		await log.append(edge("b", 1));
		expect(await log.events("b")).toEqual(await fromDb("b"));
		expect([...log.cached().keys()]).toEqual(["open", "b"]);
		expect(await log.events("a")).toEqual(await fromDb("a"));

		// An open run that ends becomes one to drop.
		await log.append(ended("open"));
		await log.events("c");
		expect(log.cached().has("open")).toBe(false);
	});

	test("derive keeps its value until the run's next append", async () => {
		const log = createRunLog(sandbox.db, { maxIdleEvents: 0 });
		let calls = 0;
		const count = (events: readonly LoggedEvent[]) => {
			calls++;
			return events.length;
		};
		await log.append(started("a"));
		await log.append(started("b"));
		await log.append(ended("b"));

		// Neither log is in memory: one read, and the logs are not kept.
		expect(await log.derive(["a", "b", "none"], count)).toEqual(
			new Map([
				["a", 1],
				["b", 2],
				["none", 0],
			]),
		);
		expect(log.cached().size).toBe(0);
		expect(calls).toBe(3);
		await log.derive(["a", "b"], count);
		expect(calls).toBe(3);

		await log.append(edge("a", 1));
		expect((await log.derive(["a", "b"], count)).get("a")).toBe(2);
		expect(calls).toBe(4);
	});
});

describe("event identity: (walker, walker seq)", () => {
	const identities = async () =>
		sandbox.db
			.select({
				seq: event.seq,
				walkerId: event.walkerId,
				walkerSeq: event.walkerSeq,
			})
			.from(event)
			.orderBy(asc(event.seq));

	test("each Walker counts its own events from 1; the local seq orders them all", async () => {
		const here = createRunLog(sandbox.db);
		const studio = createRunLog(sandbox.db, { walkerId: "studio" });
		await here.append(started("r1"));
		await studio.append(started("r2"));
		await here.append(edge("r1", 1));
		await studio.append(edge("r2", 1));
		await here.append(edge("r1", 2));

		expect(await here.walkerId()).toBe(sandbox.deviceId);
		expect(await identities()).toEqual([
			{ seq: 1, walkerId: sandbox.deviceId, walkerSeq: 1 },
			{ seq: 2, walkerId: "studio", walkerSeq: 1 },
			{ seq: 3, walkerId: sandbox.deviceId, walkerSeq: 2 },
			{ seq: 4, walkerId: "studio", walkerSeq: 2 },
			{ seq: 5, walkerId: sandbox.deviceId, walkerSeq: 3 },
		]);
	});

	test("appends at once never share a number", async () => {
		const log = createRunLog(sandbox.db);
		await Promise.all(
			Array.from({ length: 20 }, (_, i) => log.append(edge(`r${i % 3}`, i))),
		);
		const numbers = (await identities()).map((row) => row.walkerSeq);
		expect(numbers.toSorted((a, b) => a - b)).toEqual(
			Array.from({ length: 20 }, (_, i) => i + 1),
		);
	});
});
