import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { fakeHarness } from "@nightshift/agents/testing";
import { lgCheckpoint, lgWrite, run, step } from "@nightshift/db/schema";
import type { CommandNode, DecisionNode, Flow } from "@nightshift/flows";
import { asc, eq } from "drizzle-orm";
import type { PeerContext, SpaceEngine, WalkFile } from "../contract";
import { createRunHistory, ForeignRowsError } from "../log";
import { createRunBus } from "../log/bus";
import { createRunLog } from "../log/run-log";
import { createEngine } from "../run";
import { alonePeers } from "../testing/alone-peers";
import {
	createSandbox,
	type Sandbox,
	waitFor,
	withDevice,
} from "../testing/test-support";
import { createRunWalks } from "./walk-state";

/**
 * A run's walk state as files (`walk-state.ts`), over a real engine and its
 * checkpoint tables: a run that builds, then waits at a Gate.
 */

const command = (id: string, cmd: string): CommandNode => ({
	id,
	type: "command",
	position: { x: 0, y: 0 },
	command: cmd,
	output: "text",
});

const gate: DecisionNode = {
	id: "gate",
	type: "decision",
	position: { x: 0, y: 0 },
	prompt: "Ship it?",
	options: [{ name: "approve" }, { name: "reject" }],
	by: "person",
	decider: "typesafe",
};

/** build → gate (approve → ship). */
const gateFlow: Flow = {
	version: 5,
	inputs: [],
	outputs: [],
	start: "build",
	nodes: [
		command("build", "echo built"),
		gate,
		command("ship", "echo shipped"),
	],
	edges: [
		{ id: "e1", from: "build", outcome: "pass", to: "gate" },
		{ id: "e2", from: "gate", outcome: "approve", to: "ship" },
	],
};

let sandboxes: Sandbox[];
beforeEach(() => {
	sandboxes = [];
});
afterEach(async () => {
	for (const s of sandboxes) await s.cleanup();
});

/** A computer with an engine, and the parts the engine gives its peers. */
async function computer() {
	const sandbox = await createSandbox();
	sandboxes.push(sandbox);
	let context: PeerContext | undefined;
	const engine = createEngine(
		withDevice({
			db: sandbox.db,
			harnesses: { "claude-code": fakeHarness(() => ({})) },
			deviceId: sandbox.deviceId,
			dataDir: sandbox.dataDir,
			peers: (ctx) => {
				context = ctx;
				return alonePeers(ctx);
			},
		}),
		{ runLog: createRunLog(sandbox.db, { walkerId: sandbox.deviceId }) },
	);
	if (!context) throw new Error("The engine made no peers.");
	return { sandbox, engine, space: engine.space(sandbox.spaceId), context };
}

/** Starts the flow and waits until it waits at the Gate. */
async function waitingRun(space: SpaceEngine, repoPath: string) {
	const project = await space.addProject({ repoPath });
	const started = await space.startRun({
		projectId: project.id,
		flow: gateFlow,
	});
	await waitFor(
		async () => (await space.getRun(started.id)).status === "waiting",
		{ label: "the run to wait at the Gate" },
	);
	return space.getRun(started.id);
}

/** The run's checkpoint rows, in key order. */
async function checkpointRows(sandbox: Sandbox, runId: string) {
	const checkpoints = await sandbox.db
		.select()
		.from(lgCheckpoint)
		.where(eq(lgCheckpoint.threadId, runId))
		.orderBy(asc(lgCheckpoint.checkpointNs), asc(lgCheckpoint.checkpointId));
	const writes = await sandbox.db
		.select()
		.from(lgWrite)
		.where(eq(lgWrite.threadId, runId))
		.orderBy(
			asc(lgWrite.checkpointNs),
			asc(lgWrite.checkpointId),
			asc(lgWrite.taskId),
			asc(lgWrite.idx),
		);
	return { checkpoints, writes };
}

/** The walks of a database the engine does not run on: an import only. */
function walksOf(sandbox: Sandbox) {
	const log = createRunLog(sandbox.db, { walkerId: sandbox.deviceId });
	return createRunWalks({
		db: sandbox.db,
		log,
		history: createRunHistory({
			db: sandbox.db,
			dataDir: sandbox.dataDir,
			log,
			bus: createRunBus(),
		}),
	});
}

const kinds = (files: WalkFile[]) =>
	files.map((f) => [f.ref.kind, "stepId" in f.ref ? f.ref.stepId : null]);

describe("the walk state of a run", () => {
	test("is each step's transcript and command log it has, then the latest Checkpoint", async () => {
		const a = await computer();
		const detail = await waitingRun(a.space, a.sandbox.repoPath);
		const [build, open] = detail.steps.map((s) => s.id) as [string, string];

		const files = await a.context.walks.exportWalk(detail.id);
		expect(files.at(-1)?.ref).toEqual({
			kind: "checkpoint",
			spaceId: a.sandbox.spaceId,
			runId: detail.id,
		});
		// The command step wrote its command log, and the Gate its transcript.
		expect(kinds(files)).toContainEqual(["log", build]);
		expect(kinds(files)).toContainEqual(["transcript", open]);
		for (const f of files.slice(0, -1)) {
			expect(f.content).toBe(
				(await a.context.walks.ownFile(f.ref)) ?? "missing",
			);
		}
		const snapshot = JSON.parse(files.at(-1)?.content ?? "{}");
		expect(Object.keys(snapshot)).toEqual(["runId", "checkpoints", "writes"]);
		expect(snapshot.runId).toBe(detail.id);
		expect(snapshot.checkpoints.length).toBeGreaterThan(0);

		// `steps` keeps the files of those steps only.
		const onlyBuild = await a.context.walks.exportWalk(detail.id, {
			steps: [build],
		});
		expect(
			onlyBuild.every((f) => !("stepId" in f.ref) || f.ref.stepId === build),
		).toBe(true);
		expect(
			kinds(await a.context.walks.exportWalk(detail.id, { steps: [] })),
		).toEqual([["checkpoint", null]]);
		await a.space.stopRun(detail.id);
	});

	test("of a run walked elsewhere is empty, and so is each of its files", async () => {
		const a = await computer();
		const detail = await waitingRun(a.space, a.sandbox.repoPath);
		const stepId = detail.steps[0]?.id as string;
		const ref = {
			kind: "log" as const,
			spaceId: a.sandbox.spaceId,
			runId: detail.id,
			stepId,
		};
		expect(await a.context.walks.ownFile(ref)).not.toBeNull();

		await a.sandbox.db
			.update(run)
			.set({ walkerId: "another-device" })
			.where(eq(run.id, detail.id));
		expect(await a.context.walks.exportWalk(detail.id)).toEqual([]);
		expect(await a.context.walks.ownFile(ref)).toBeNull();
		expect(
			await a.context.walks.ownFile({
				kind: "checkpoint",
				spaceId: a.sandbox.spaceId,
				runId: detail.id,
			}),
		).toBeNull();
	});

	test("has no file of a step of another run", async () => {
		const a = await computer();
		const first = await waitingRun(a.space, a.sandbox.repoPath);
		const project = await a.space.addProject({ repoPath: a.sandbox.repoPath });
		const second = await a.space.startRun({
			projectId: project.id,
			flow: { ...gateFlow, nodes: [command("build", "echo again")], edges: [] },
		});
		await waitFor(
			async () => (await a.space.getRun(second.id)).status === "finished",
			{ label: "the second run to end" },
		);
		const [other] = await a.sandbox.db
			.select({ id: step.id })
			.from(step)
			.where(eq(step.runId, second.id));
		expect(
			await a.context.walks.ownFile({
				kind: "log",
				spaceId: a.sandbox.spaceId,
				runId: first.id,
				stepId: other?.id as string,
			}),
		).toBeNull();
		await a.space.stopRun(first.id);
	});

	test("imports on another Replica as the latest checkpoint rows, byte for byte, once", async () => {
		const a = await computer();
		const detail = await waitingRun(a.space, a.sandbox.repoPath);
		const files = await a.context.walks.exportWalk(detail.id);
		const checkpoint = files.at(-1)?.content as string;

		const b = await createSandbox();
		sandboxes.push(b);
		const walks = walksOf(b);
		await walks.importWalk(detail.id, checkpoint);

		const fromA = JSON.parse(checkpoint) as {
			checkpoints: { checkpointId: string }[];
		};
		const onB = await checkpointRows(b, detail.id);
		const onA = await checkpointRows(a.sandbox, detail.id);
		const latest = new Set(fromA.checkpoints.map((c) => c.checkpointId));
		expect(onB.checkpoints).toEqual(
			onA.checkpoints.filter((c) => latest.has(c.checkpointId)),
		);
		expect(onB.writes).toEqual(
			onA.writes.filter((w) => latest.has(w.checkpointId)),
		);
		// A second import changes nothing, and rows B has are kept.
		await walks.importWalk(detail.id, checkpoint);
		expect(await checkpointRows(b, detail.id)).toEqual(onB);
		await a.space.stopRun(detail.id);
	});

	test("takes a step's transcript from its old Walker into the step's own file, and never over one it has", async () => {
		const a = await computer();
		const detail = await waitingRun(a.space, a.sandbox.repoPath);
		const gateStep = detail.steps[1]?.id as string;
		const [row] = await a.sandbox.db
			.select({ transcriptPath: step.transcriptPath })
			.from(step)
			.where(eq(step.id, gateStep));
		const path = row?.transcriptPath as string;
		const own = await readFile(path, "utf8");
		const walks = walksOf(a.sandbox);
		const fromBefore = `${JSON.stringify({ ...JSON.parse(own.split("\n")[0] as string), seq: 99 })}\n`;

		// It has entries of its own: they stay.
		await walks.importTranscript(detail.id, gateStep, fromBefore);
		expect(await readFile(path, "utf8")).toBe(own);
		// Not a step of the run: nothing is written.
		await rm(path);
		await walks.importTranscript("another-run", gateStep, fromBefore);
		expect(existsSync(path)).toBe(false);
		// None here: the old Walker's part is the start of its file.
		await walks.importTranscript(detail.id, gateStep, fromBefore);
		expect(await readFile(path, "utf8")).toBe(fromBefore);
		await a.space.stopRun(detail.id);
	});

	test("refuses a Checkpoint with a row of another run, and writes nothing", async () => {
		const a = await computer();
		const detail = await waitingRun(a.space, a.sandbox.repoPath);
		const checkpoint = (await a.context.walks.exportWalk(detail.id)).at(-1)
			?.content as string;
		const parsed = JSON.parse(checkpoint) as {
			runId: string;
			checkpoints: { threadId: string }[];
			writes: { threadId: string }[];
		};

		const b = await createSandbox();
		sandboxes.push(b);
		const walks = walksOf(b);
		const foreignWrite = {
			...parsed,
			writes: [
				...parsed.writes,
				{ ...(parsed.checkpoints[0] as object), threadId: "other-run" },
			],
		};
		const lastCheckpoint = parsed.checkpoints.length - 1;
		const foreignCheckpoint = {
			...parsed,
			checkpoints: parsed.checkpoints.map((c, i) =>
				i === lastCheckpoint ? { ...c, threadId: "other-run" } : c,
			),
		};
		for (const bad of [
			{ ...parsed, runId: "other-run" },
			foreignWrite,
			foreignCheckpoint,
		]) {
			await expect(
				walks.importWalk(detail.id, JSON.stringify(bad)),
			).rejects.toBeInstanceOf(ForeignRowsError);
		}
		expect(await checkpointRows(b, detail.id)).toEqual({
			checkpoints: [],
			writes: [],
		});
		expect(
			(await b.db.select().from(lgCheckpoint)).length +
				(await b.db.select().from(lgWrite)).length,
		).toBe(0);
		await a.space.stopRun(detail.id);
	});
});
