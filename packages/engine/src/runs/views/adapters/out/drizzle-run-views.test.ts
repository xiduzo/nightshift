import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { project, run } from "@nightshift/db/schema";
import { migratedDb } from "@nightshift/db/testing";
import { asDate, now, parseInstant } from "@nightshift/time";
import { eq } from "drizzle-orm";
import {
	createRunBus,
	createRunLog,
	getRunRow,
	type RunBus,
	type TranscriptEntry,
} from "../../../../log";
import { ownDevice } from "../../../../testing/alone-directory";
import { localSpaceId } from "../../../../testing/test-support";
import type { RunViews } from "../../application/ports";
import type { RunEvent, ViewNeighbours } from "../../test-support";
import { drizzleRunViews } from "./drizzle-run-views";

/** What the peers and this computer's files hold of each step, by step id. */
type Saved = {
	whole: Map<string, TranscriptEntry[]>;
	own: Map<string, TranscriptEntry[]>;
	/** Steps whose read goes on until it is stopped: a Host that is away. */
	away: Set<string>;
};

/** The neighbours the views read: every Walker is this computer, and `saved` holds the transcripts. */
function neighbours(saved: Saved): ViewNeighbours {
	return {
		walkers: async (_spaceId, ids) =>
			new Map(ids.map((id) => [id, { id, name: null, thisDevice: true }])),
		pendingCommands: async () => new Map(),
		stepEntries: async function* (step, _afterSeq, signal) {
			yield* saved.whole.get(step.stepId) ?? [];
			if (!saved.away.has(step.stepId)) return;
			await new Promise((resolve) =>
				signal.addEventListener("abort", resolve, { once: true }),
			);
		},
		ownEntries: async (step) => saved.own.get(step.stepId) ?? [],
	};
}

const stepStarted = (stepId: string): Omit<RunEvent, "at"> => ({
	type: "StepStarted",
	runId: "r1",
	stepId,
	payload: {
		nodeId: "a",
		nodeType: "agent",
		visit: 1,
		transcriptPath: `/t/${stepId}`,
		logPath: null,
	},
});

const runStarted = (runId: string): Omit<RunEvent, "at"> => ({
	type: "RunStarted",
	runId,
	payload: { projectId: "p", flowName: "f", title: "t", start: "a" },
});

const ids = (runs: { id: string }[]) => runs.map((r) => r.id);

const change = (stepId?: string): Parameters<RunBus["publish"]>[1] =>
	stepId === undefined
		? { kind: "status-changed" }
		: { kind: "step-changed", stepId };

const make = async (neighbours: ViewNeighbours) => {
	const db = await migratedDb();
	const deviceId = (await ownDevice(db)).id;
	const spaceId = await localSpaceId(db);
	const bus = createRunBus();
	const log = createRunLog(db, { walkerId: deviceId, dataDir: "/nowhere" });
	return {
		views: drizzleRunViews({
			db,
			log,
			bus,
			deviceId,
			harnessOf: () => undefined,
			...neighbours,
		}),
		spaceId,
		async addProject(id: string) {
			await db.insert(project).values({ id, spaceId, name: id });
		},
		async addRun({
			id,
			createdAt,
			...columns
		}: {
			id: string;
			title?: string;
			createdAt?: number;
			worktreePath?: string;
			branch?: string;
			baseRef?: string;
			walkerId?: string;
			deviceId?: string;
		}) {
			await db.insert(run).values({
				id,
				spaceId,
				projectId: "p",
				flow: "{}",
				title: id,
				worktreePath: "",
				branch: "",
				baseRef: "",
				walkerId: deviceId,
				createdAt: asDate(createdAt ?? now()),
				...columns,
			});
		},
		async startedAt(runId: string, at: number) {
			await db
				.update(run)
				.set({ createdAt: asDate(at) })
				.where(eq(run.id, runId));
		},
		async append(event: Omit<RunEvent, "at">) {
			await log.append(event);
		},
		changed: (runId: string, stepId?: string) =>
			bus.publish(runId, change(stepId)),
		row: (runId: string) => getRunRow(db, runId),
	};
};

describe("RunViews over the database and the run log", () => {
	let under: Awaited<ReturnType<typeof make>>;
	let views: RunViews;
	const saved: Saved = { whole: new Map(), own: new Map(), away: new Set() };
	const controllers: AbortController[] = [];

	beforeEach(async () => {
		under = await make(neighbours(saved));
		views = under.views;
		await under.addProject("p");
		await under.addRun({
			id: "r1",
			title: "r1",
			worktreePath: "/w",
			branch: "b",
			baseRef: "main",
		});
		await under.append(runStarted("r1"));
	});
	afterEach(() => {
		for (const controller of controllers.splice(0)) controller.abort();
		saved.whole.clear();
		saved.own.clear();
		saved.away.clear();
	});

	test("the run page shows the steps the run log keeps", async () => {
		await under.append(stepStarted("s1"));
		const detail = await views.getRun(await under.row("r1"));
		expect(detail.steps).toMatchObject([
			{
				id: "s1",
				nodeId: "a",
				nodeType: "agent",
				visit: 1,
				endedAt: null,
				outcome: null,
				outputs: {},
				error: null,
				scope: null,
				costUsd: 0,
				device: null,
			},
		]);
		expect(detail.status).toBe("running");
		expect(await views.getStep(await under.row("r1"), "s1")).toMatchObject({
			id: "s1",
			nodeId: "a",
			sessions: [],
			items: [],
		});
	});

	test("a step that ended shows its outcome and its outputs", async () => {
		await under.append(stepStarted("s1"));
		await under.append({
			type: "StepEnded",
			runId: "r1",
			stepId: "s1",
			payload: { outcome: "pass", outputs: { summary: "Done" }, error: null },
		});
		const step = await views.getStep(await under.row("r1"), "s1");
		expect(step).toMatchObject({
			outcome: "pass",
			outputs: { summary: "Done" },
		});
		expect(step.endedAt).not.toBeNull();
	});

	test("a run's status and place come from one row and the run log", async () => {
		expect(await views.runHere("r1")).toEqual({
			id: "r1",
			status: "running",
			wakeAt: null,
			waitReason: null,
			walkedHere: true,
			stepsHere: true,
		});
		await under.addRun({
			id: "r2",
			walkerId: "device-far",
			deviceId: "device-far",
		});
		expect(await views.runHere("r2")).toMatchObject({
			walkedHere: false,
			stepsHere: false,
		});
		expect(await views.runHere("missing")).toBeNull();
		expect(await views.runStatus("r1")).toBe("running");
	});

	test("a run the log has nothing on has no status and no trace", async () => {
		await under.addRun({ id: "r2" });
		expect(await views.runStatus("r2")).toBeNull();
		expect(await views.trace("r2")).toBeNull();
		expect(await views.trace("r1")).toMatchObject({ runId: "r1" });
	});

	test("a run that sleeps for an offline Device says so, and its summary does not", async () => {
		await under.append(stepStarted("s1"));
		await under.append({
			type: "WaitStarted",
			runId: "r1",
			stepId: "s1",
			payload: {
				reason: "device-offline",
				until: 60_000,
				message: "studio-mac is offline. The step starts when it is back.",
				since: 0,
				deviceId: "device-2",
				deviceName: "studio-mac",
			},
		});
		expect(await views.runHere("r1")).toMatchObject({
			status: "sleeping",
			wakeAt: 60_000,
			waitReason: "device-offline",
		});
		const detail = await views.getRun(await under.row("r1"));
		expect(detail).not.toHaveProperty("waitReason");
	});

	test("a run whose worktree a step made later shows it from the log; an old run from its row", async () => {
		await under.addRun({ id: "r2", title: "r2", baseRef: "main" });
		await under.append({
			type: "RunStarted",
			runId: "r2",
			payload: { projectId: "p", flowName: null, title: "r2", start: "a" },
		});
		const where = (r: {
			branch: string;
			worktreePath: string;
			baseRef: string;
		}) => ({
			branch: r.branch,
			worktreePath: r.worktreePath,
			baseRef: r.baseRef,
		});
		const listed = async (id: string) => {
			const found = (await views.listRuns(under.spaceId)).find(
				(r) => r.id === id,
			);
			if (!found) throw new Error(`No run ${id}.`);
			return where(found);
		};
		expect(await listed("r2")).toEqual({
			branch: "",
			worktreePath: "",
			baseRef: "main",
		});

		const made = {
			worktreePath: "/w2",
			branch: "nightshift/r2",
			baseRef: "c0ffee",
		};
		await under.append({
			type: "WorktreeCreated",
			runId: "r2",
			payload: made,
		});
		expect(await listed("r2")).toEqual(made);
		expect(where(await views.getRun(await under.row("r2")))).toEqual(made);
		expect(await listed("r1")).toEqual({
			worktreePath: "/w",
			branch: "b",
			baseRef: "main",
		});
	});

	test("a run list pages by limit and cursor, newest first", async () => {
		// r1 is the oldest; r2 and r3 start at the same time, so the id orders them.
		await under.startedAt("r1", 1_000);
		for (const id of ["r2", "r3", "r4"]) {
			await under.addRun({ id, createdAt: id === "r4" ? 3_000 : 2_000 });
		}
		const all = await views.listRuns(under.spaceId);
		expect(ids(all)).toEqual(["r4", "r3", "r2", "r1"]);

		const first = await views.listRuns(under.spaceId, undefined, {
			limit: 2,
		});
		expect(ids(first)).toEqual(["r4", "r3"]);
		const last = first.at(-1);
		if (!last) throw new Error("No page.");
		const second = await views.listRuns(under.spaceId, "p", {
			limit: 2,
			cursor: { createdAt: last.createdAt, id: last.id },
		});
		expect(ids(second)).toEqual(["r2", "r1"]);
		expect(second[1]?.status).toBe("running");

		// Only r1 has events of a running run.
		const running = await views.listRuns(under.spaceId, undefined, {
			limit: 1,
			statuses: ["running"],
		});
		expect(ids(running)).toEqual(["r1"]);
	});

	test("a run list by activity puts the run that last did something first", async () => {
		// r1 started first, and its log has the only event. The others have
		// no event yet: their start stands in.
		await under.startedAt("r1", 1_000);
		for (const id of ["r2", "r3", "r4"]) {
			await under.addRun({ id, createdAt: id === "r4" ? 3_000 : 2_000 });
		}
		const byActivity = { order: "activity" } as const;
		const all = await views.listRuns(under.spaceId, undefined, byActivity);
		expect(ids(all)).toEqual(["r1", "r4", "r3", "r2"]);
		expect(all[0]?.lastActivityAt).toBeGreaterThan(3_000);
		expect(all.slice(1).map((r) => r.lastActivityAt)).toEqual([
			3_000, 2_000, 2_000,
		]);

		const first = await views.listRuns(under.spaceId, undefined, {
			...byActivity,
			limit: 2,
		});
		expect(ids(first)).toEqual(["r1", "r4"]);
		const last = first.at(-1);
		if (!last) throw new Error("No page.");
		const second = await views.listRuns(under.spaceId, "p", {
			...byActivity,
			limit: 2,
			cursor: {
				createdAt: last.createdAt,
				id: last.id,
				lastActivityAt: last.lastActivityAt,
			},
		});
		expect(ids(second)).toEqual(["r3", "r2"]);

		// Feedback is no work of the run: a rating leaves it where it is.
		await under.append({
			type: "Scored",
			runId: "r2",
			payload: { score: "useful", value: 1, label: null },
		});
		const rated = await views.listRuns(under.spaceId, undefined, byActivity);
		expect(ids(rated)).toEqual(["r1", "r4", "r3", "r2"]);
		expect(rated[3]?.lastActivityAt).toBe(2_000);

		// The run does something: it goes to the top.
		await under.append(runStarted("r2"));
		const moved = await views.listRuns(under.spaceId, undefined, byActivity);
		expect(ids(moved)[0]).toBe("r2");
		// By start, nothing moved.
		expect(ids(await views.listRuns(under.spaceId))).toEqual([
			"r4",
			"r3",
			"r2",
			"r1",
		]);
	});

	test("each project's runs come counted by status, with the newest run", async () => {
		await under.addProject("q");
		await under.addRun({
			id: "r2",
			title: "Second",
			createdAt: now() + 60_000,
		});
		await under.append(runStarted("r2"));
		await under.append({
			type: "RunEnded",
			runId: "r2",
			payload: { status: "finished", reason: null, endReason: "finished" },
		});
		const counts = await views.projectRuns(under.spaceId);
		expect(counts.get("p")).toMatchObject({
			total: 2,
			statuses: { running: 1, finished: 1 },
			last: { id: "r2", title: "Second" },
			nextWakeAt: null,
		});
		// Both runs started today: every range of days counts them.
		expect(counts.get("p")?.nights).toEqual(
			([7, 30, 90] as const).map((nights) => ({
				nights,
				total: 2,
				statuses: { running: 1, finished: 1 },
			})),
		);
		// A project without runs is not in it.
		expect(counts.has("q")).toBe(false);
	});

	test("a project's test runs count in its run list, not in its days", async () => {
		await under.addRun({
			id: "r2",
			title: "A test",
			createdAt: now() + 60_000,
		});
		await under.append({
			type: "RunStarted",
			runId: "r2",
			payload: {
				projectId: "p",
				flowName: "f",
				title: "t",
				start: "a",
				test: { pinned: {}, skipped: { check: "pass" } },
			},
		});
		await under.append({
			type: "RunEnded",
			runId: "r2",
			payload: { status: "failed", reason: "It broke.", endReason: "_OTHER" },
		});
		const counted = (await views.projectRuns(under.spaceId)).get("p");
		// The run list shows it: the total and the statuses count it.
		expect(counted).toMatchObject({
			total: 2,
			statuses: { running: 1, failed: 1 },
			tests: { failed: 1 },
			last: { id: "r2" },
		});
		// The days count as the dashboard does: without it.
		expect(counted?.nights).toEqual(
			([7, 30, 90] as const).map((nights) => ({
				nights,
				total: 1,
				statuses: { running: 1 },
			})),
		);
	});

	test("a project's last days start at midnight on the reader's clock", async () => {
		// 23:30 UTC on 3 November is 00:30 on 4 November in Amsterdam (UTC+1).
		await under.startedAt("r1", parseInstant("2026-11-03T23:30:00Z"));
		// The last 7 days end on 10 November: they start on 4 November.
		const at = parseInstant("2026-11-10T12:00:00Z");
		const week = async (timeZone: string) =>
			(await views.projectRuns(under.spaceId, { now: at, timeZone }))
				.get("p")
				?.nights?.map(({ nights, total }) => [nights, total]);
		expect(await week("UTC")).toEqual([
			[7, 0],
			[30, 1],
			[90, 1],
		]);
		expect(await week("Europe/Amsterdam")).toEqual([
			[7, 1],
			[30, 1],
			[90, 1],
		]);
	});

	test("a run that waits at no Gate has none in the inbox, open or answered", async () => {
		expect(await views.listGates(under.spaceId)).toEqual([]);
		expect(await views.listAnsweredGates(under.spaceId, 0)).toEqual([]);
	});

	test("an open Gate is in the inbox until it is answered", async () => {
		await under.append(stepStarted("s1"));
		await under.append({
			type: "GateOpened",
			runId: "r1",
			stepId: "s1",
			payload: { question: "Go on?", choices: [{ name: "yes" }] },
		});
		const gate = {
			spaceId: under.spaceId,
			runId: "r1",
			runTitle: "r1",
			projectId: "p",
			projectName: "p",
			stepId: "s1",
			nodeId: "a",
			question: "Go on?",
			choices: [{ name: "yes" }],
			urgency: "today",
		};
		expect(await views.listGates(under.spaceId)).toMatchObject([
			{
				...gate,
				lockScreen: false,
				deadline: null,
				form: null,
				walker: { thisDevice: true },
				answerPending: false,
				branchesWork: false,
			},
		]);
		expect(await views.listAnsweredGates(under.spaceId, 0)).toEqual([]);

		await under.append({
			type: "Scored",
			runId: "r1",
			stepId: "s1",
			payload: {
				score: "gate_decision",
				value: 1,
				label: "yes",
				by: "person",
			},
		});
		await under.append({
			type: "StepEnded",
			runId: "r1",
			stepId: "s1",
			payload: { outcome: "yes", outputs: { note: "Fine." }, error: null },
		});
		expect(await views.listGates(under.spaceId)).toEqual([]);
		expect(await views.listAnsweredGates(under.spaceId, 0)).toMatchObject([
			{ ...gate, answeredBy: "person", answer: "yes", note: "Fine." },
		]);
		expect(
			await views.listAnsweredGates(under.spaceId, now() + 60_000),
		).toEqual([]);
	});

	test("a watch sends the transcript after the cursor, then each change", async () => {
		const entry = (seq: number): TranscriptEntry => ({
			seq,
			stepId: "s1",
			sessionId: null,
			at: seq,
			event: { type: "command-output", stream: "stdout", text: `${seq}` },
		});
		await under.append(stepStarted("s1"));
		saved.whole.set("s1", [entry(1), entry(2)]);
		const controller = new AbortController();
		controllers.push(controller);
		const stream = views.watch(await under.row("r1"), controller.signal, 1);
		const next = async () => (await stream.next()).value;
		expect(await next()).toMatchObject({ kind: "status" });
		expect(await next()).toMatchObject({ kind: "step" });
		expect(await next()).toEqual({ kind: "transcript", entry: entry(2) });

		await under.append(stepStarted("s2"));
		under.changed("r1", "s2");
		expect(await next()).toMatchObject({ kind: "step", step: { id: "s2" } });

		await under.append({
			type: "RunEnded",
			runId: "r1",
			payload: { status: "finished", reason: null, endReason: "finished" },
		});
		under.changed("r1");
		expect(await next()).toEqual({ kind: "status", status: "finished" });
		const last = stream.next();
		controller.abort();
		expect((await last).done).toBe(true);
	});

	test("a watch sends the run's status, then its steps", async () => {
		await under.append(stepStarted("s1"));
		const controller = new AbortController();
		controllers.push(controller);
		const stream = views.watch(await under.row("r1"), controller.signal, 0);
		expect((await stream.next()).value).toEqual({
			kind: "status",
			status: "running",
		});
		const step = (await stream.next()).value;
		expect(step).toMatchObject({ kind: "step", step: { id: "s1" } });
		await stream.return(undefined);
	});

	describe("a step's saved transcript", () => {
		const entry = (seq: number, stepId: string): TranscriptEntry => ({
			seq,
			stepId,
			sessionId: null,
			at: seq,
			event: { type: "command-output", stream: "stdout", text: `${seq}` },
		});
		const ended = (stepId: string): Omit<RunEvent, "at"> => ({
			type: "StepEnded",
			runId: "r1",
			stepId,
			payload: { outcome: "fail", outputs: {}, error: null },
		});
		const read = async (
			stepId: string,
			signal = new AbortController().signal,
		) => views.stepTranscript(await under.row("r1"), stepId, signal);

		test("a step that ended: all of it, wherever the run was walked", async () => {
			await under.append(stepStarted("s1"));
			await under.append(ended("s1"));
			saved.whole.set("s1", [entry(1, "s1"), entry(2, "s1")]);
			saved.own.set("s1", [entry(1, "s1")]);
			expect(await read("s1")).toEqual({
				entries: [entry(1, "s1"), entry(2, "s1")],
				holds: "whole",
			});
		});

		test("a step that still runs: what this computer keeps of it so far", async () => {
			await under.append(stepStarted("s1"));
			// Its live read never ends while it runs: it is not asked.
			saved.whole.set("s1", [entry(1, "s1"), entry(2, "s1")]);
			saved.away.add("s1");
			saved.own.set("s1", [entry(1, "s1")]);
			expect(await read("s1")).toEqual({
				entries: [entry(1, "s1")],
				holds: "so-far",
			});
		});

		test("a read that is stopped keeps what came, and says so", async () => {
			await under.append(stepStarted("s1"));
			await under.append(ended("s1"));
			saved.whole.set("s1", [entry(1, "s1")]);
			saved.away.add("s1");
			const controller = new AbortController();
			const reading = read("s1", controller.signal);
			await new Promise((resolve) => setTimeout(resolve, 5));
			controller.abort();
			expect(await reading).toEqual({
				entries: [entry(1, "s1")],
				holds: "cut",
			});
		});

		test("a step the run does not have is not found", async () => {
			await expect(read("nope")).rejects.toMatchObject({ kind: "not-found" });
			await expect(
				views.getStep(await under.row("r1"), "nope"),
			).rejects.toMatchObject({ kind: "not-found" });
		});
	});
});
