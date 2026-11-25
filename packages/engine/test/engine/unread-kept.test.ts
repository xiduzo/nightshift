import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, utimes, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fakeHarness } from "@nightshift/agents/testing";
import { run, ydoc } from "@nightshift/db/schema";
import { FLOW_VERSION, type Flow, flowSchema } from "@nightshift/flows";
import { now } from "@nightshift/time";
import { eq } from "drizzle-orm";
import * as Y from "yjs";
import { NIGHT_SHIFT } from "../../src/contract";
import { deviceDocumentName } from "../../src/documents";
import type { EngineInternals } from "../../src/engine";
import { defaultRunSettings } from "../../src/settings/settings";
import type { SpaceEngine } from "../../src/space-engine";
import {
	createSandbox,
	databaseClockAhead,
	mustGit,
	type Sandbox,
	waitFor,
	withDevice,
} from "../../src/testing/test-support";
import { createEngine } from "../../src/wire";

/**
 * What this version cannot read is never lost because of that: a start,
 * its recovery and every sweep, long after, remove none of it.
 */

const DAYS = 100;
const DAY_MS = 24 * 60 * 60_000;

let sandbox: Sandbox;
let daemons: AbortController[];
let skew: number;

beforeEach(async () => {
	sandbox = await createSandbox();
	skew = await databaseClockAhead(sandbox.db);
	daemons = [];
});
afterEach(async () => {
	for (const daemon of daemons) daemon.abort();
	await Bun.sleep(20);
	await sandbox.cleanup();
});

function startDaemon(internals: EngineInternals = {}): SpaceEngine {
	const controller = new AbortController();
	daemons.push(controller);
	return createEngine(
		withDevice({
			db: sandbox.db,
			harnesses: { "claude-code": fakeHarness() },
			dataDir: sandbox.dataDir,
			scheduler: false,
			settings: () => ({ ...defaultRunSettings(), maxConcurrentRuns: 4 }),
		}),
		{ cleanupDelayMs: 60 * 60_000, signal: controller.signal, ...internals },
	).space(sandbox.spaceId, NIGHT_SHIFT);
}

/** A daemon `days` later, after its first round of sweeps. */
async function sweptLater(days: number): Promise<SpaceEngine> {
	for (const daemon of daemons) daemon.abort();
	const swept = Promise.withResolvers<void>();
	const later = startDaemon({
		now: () => now() + skew + days * DAY_MS,
		cleanupDelayMs: 0,
		cleanupSwept: swept.resolve,
	});
	await swept.promise;
	return later;
}

const at = { position: { x: 0, y: 0 } };
const flowOf = (first: object): Flow =>
	flowSchema.parse({
		version: FLOW_VERSION,
		start: "first",
		nodes: [{ id: "first", ...at, ...first }],
		edges: [],
	});
const gate = flowOf({
	type: "decision",
	by: "person",
	prompt: "Go on?",
	options: [{ name: "yes", label: "Yes" }],
});
const nap = flowOf({
	type: "wait",
	until: { kind: "duration", minutes: 60 * 24 * 365 },
});
const work = flowOf({ type: "command", command: "sleep 30" });

/** Starts a run of `flow`, waits for `status`, and leaves the only copy of some work in its folder. */
async function runWithWork(
	engine: SpaceEngine,
	projectId: string,
	flow: Flow,
	status: string,
) {
	const { id } = await engine.startRun({ projectId, flow });
	const there = await waitFor(
		async () => {
			const found = await engine.getRun(id);
			return found.status === status && existsSync(found.worktreePath)
				? found
				: null;
		},
		{ label: `the run to be ${status}`, timeoutMs: 15_000 },
	);
	const file = join(there.worktreePath, "only-copy.txt");
	await writeFile(file, "work\n");
	return { id, file };
}

/** What a later or an earlier version, or a fault, made of the run's flow. */
const UNREAD: Record<string, (flow: object) => string> = {
	older: (flow) => JSON.stringify({ ...flow, version: FLOW_VERSION - 1 }),
	newer: (flow) => JSON.stringify({ ...flow, version: FLOW_VERSION + 1 }),
	invalid: () => "{not json",
};

const refs = async () =>
	(
		await mustGit(sandbox.repoPath, [
			"for-each-ref",
			"--format=%(refname) %(objectname)",
		])
	).split("\n");

describe.each(Object.keys(UNREAD))("a run whose flow is %s", (why) => {
	test.each([
		["waits", gate, "waiting"],
		["sleeps", nap, "sleeping"],
		["runs", work, "running"],
	] as const)(
		"and that %s keeps its work",
		async (_what, flow, status) => {
			const engine = startDaemon();
			const app = await engine.addProject({ repoPath: sandbox.repoPath });
			const research = await engine.addProjectWithoutFolder({ name: "R" });
			const inCopy = await runWithWork(engine, app.id, flow, status);
			const inFolder = await runWithWork(engine, research.id, flow, status);
			const control = await runWithWork(engine, research.id, gate, "waiting");
			await engine.act(control.id, { kind: "stop" });
			const copy = dirname(inCopy.file);
			const git = ["-c", "user.name=t", "-c", "user.email=t@t.invalid"];
			await mustGit(copy, [...git, "commit", "--allow-empty", "-qm", "work"]);
			const kept = `refs/nightshift/kept/${inCopy.id.slice(0, 8)}/copy`;
			await mustGit(copy, ["update-ref", kept, "HEAD"]);
			for (const daemon of daemons) daemon.abort();
			for (const { id } of [inCopy, inFolder]) {
				await sandbox.db
					.update(run)
					.set({ flow: UNREAD[why]?.(flow) ?? "" })
					.where(eq(run.id, id));
			}
			const before = await refs();
			const warn = spyOn(console, "warn").mockImplementation(() => {});
			try {
				// The first start, then one long after.
				await sweptLater(0);
				const later = await sweptLater(DAYS);
				expect(existsSync(control.file)).toBe(false);
				expect(existsSync(inCopy.file)).toBe(true);
				expect(existsSync(inFolder.file)).toBe(true);
				expect(await refs()).toEqual(before);
				expect(before.join()).toContain(kept);
				// No action of the run frees what a cut-short one keeps.
				if ((await later.getRun(inFolder.id)).status === "interrupted") {
					await later.act(inFolder.id, { kind: "stop" });
					await expect(
						later.act(inFolder.id, { kind: "resume" }),
					).rejects.toThrow();
					expect((await later.getRun(inFolder.id)).status).toBe("interrupted");
				}
				expect(await later.listRunFiles(inFolder.id)).toMatchObject({
					here: true,
					cleanupAt: null,
				});
			} finally {
				warn.mockRestore();
			}
		},
		60_000,
	);
});

/** What a timer or a step's limit would end long after: a Gate with a deadline, a step with a time budget. */
const gateDue = flowOf({
	type: "decision",
	by: "person",
	prompt: "Go on?",
	options: [{ name: "yes", label: "Yes" }],
	deadline: { minutes: 60, choose: "yes" },
});
const napDue = flowOf({
	type: "wait",
	until: { kind: "duration", minutes: 60 },
});
const workDue = flowOf({
	type: "command",
	command: "sleep 30",
	timeoutMinutes: 1,
});

describe.each(["newer", "invalid"])("time that passes a %s flow", (why) => {
	test.each([
		["a Gate's deadline", gateDue, "waiting", "waiting"],
		["a wake time", napDue, "sleeping", "sleeping"],
		["a step's time budget", workDue, "running", "interrupted"],
	] as const)(
		"%s ends no run",
		async (_what, flow, status, after) => {
			const engine = startDaemon();
			const research = await engine.addProjectWithoutFolder({ name: "R" });
			const left = await runWithWork(engine, research.id, flow, status);
			for (const daemon of daemons) daemon.abort();
			await sandbox.db
				.update(run)
				.set({ flow: UNREAD[why]?.(flow) ?? "" })
				.where(eq(run.id, left.id));
			const warn = spyOn(console, "warn").mockImplementation(() => {});
			const woke = Promise.withResolvers<void>();
			const error = spyOn(console, "error").mockImplementation(() =>
				woke.resolve(),
			);
			try {
				const later = await sweptLater(DAYS);
				// The timer's Turn is refused, and says so.
				if (after !== "interrupted") await woke.promise;
				expect((await later.getRun(left.id)).status).toBe(after);
				const last = await sweptLater(2 * DAYS);
				expect((await last.getRun(left.id)).status).toBe(after);
				expect(existsSync(left.file)).toBe(true);
			} finally {
				warn.mockRestore();
				error.mockRestore();
			}
		},
		60_000,
	);
});

test("a run that calls a flow this version cannot read is not continued either", async () => {
	const engine = startDaemon();
	const research = await engine.addProjectWithoutFolder({ name: "R" });
	const left = await runWithWork(engine, research.id, napDue, "sleeping");
	for (const daemon of daemons) daemon.abort();
	await sandbox.db
		.update(run)
		.set({ bodyFlows: JSON.stringify({ body: { ...gate, nodes: "?" } }) })
		.where(eq(run.id, left.id));
	const woke = Promise.withResolvers<void>();
	const error = spyOn(console, "error").mockImplementation(() =>
		woke.resolve(),
	);
	try {
		const later = await sweptLater(DAYS);
		await woke.promise;
		expect((await later.getRun(left.id)).status).toBe("sleeping");
		expect(existsSync(left.file)).toBe(true);
	} finally {
		error.mockRestore();
	}
}, 60_000);

test("a start and every sweep leave each stored entry of another format", async () => {
	const engine = startDaemon();
	const app = await engine.addProject({ repoPath: sandbox.repoPath });
	for (const daemon of daemons) daemon.abort();
	const other = { other: "format" };
	const maps: Record<string, string[]> = {
		[deviceDocumentName(sandbox.deviceId)]: [
			"profiles",
			"cliTools",
			"connections",
			"offers",
			"settings",
		],
		[`space:${sandbox.spaceId}`]: ["projects", "clones", "devices", "offers"],
		[`flows:${app.id}`]: ["flows", "schedules", "notices"],
		[`knowledge:${app.id}`]: ["files", "settings"],
	};
	const contents = async () => {
		const found: Record<string, unknown> = {};
		for (const row of await sandbox.db.select().from(ydoc)) {
			const doc = new Y.Doc();
			Y.applyUpdate(doc, new Uint8Array(row.state));
			found[row.name] = Object.fromEntries(
				(maps[row.name] ?? []).map((key) => [key, doc.getMap(key).toJSON()]),
			);
		}
		return found;
	};
	for (const [name, keys] of Object.entries(maps)) {
		const [row] = await sandbox.db
			.select()
			.from(ydoc)
			.where(eq(ydoc.name, name));
		const doc = new Y.Doc();
		if (row) Y.applyUpdate(doc, new Uint8Array(row.state));
		for (const key of keys) doc.getMap(key).set("unread", other);
		if (name.startsWith("device:")) doc.getMap("facts").set("secrets", ["OLD"]);
		const state = Buffer.from(Y.encodeStateAsUpdate(doc));
		await sandbox.db
			.insert(ydoc)
			.values({ name, state })
			.onConflictDoUpdate({ target: ydoc.name, set: { state } });
	}
	// A run folder of no run known here that is not due yet.
	const recent = join(sandbox.dataDir, "run-folders", "stranger");
	await mkdir(recent, { recursive: true });
	const later = (now() + skew + DAYS * DAY_MS) / 1000;
	await utimes(recent, later, later);
	const before = await contents();

	await sweptLater(0);
	await sweptLater(DAYS);

	const after = await contents();
	for (const name of Object.keys(before)) {
		expect(after[name]).toMatchObject(before[name] as object);
	}
	expect(existsSync(recent)).toBe(true);
});
