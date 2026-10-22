import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { fakeHarness } from "@nightshift/agents/testing";
import { project, step } from "@nightshift/db/schema";
import type { CommandNode, DecisionNode, Flow } from "@nightshift/flows";
import { eq } from "drizzle-orm";
import type {
	OwnDevice,
	PeerContext,
	PeersFactory,
	WalkRef,
} from "../contract/peers";
import { createRunLog } from "../log/run-log";
import { parseTranscript, readTranscriptFile } from "../log/transcripts";
import { alonePeers } from "../testing/alone-peers";
import {
	createSandbox,
	type Sandbox,
	waitFor,
	withDevice,
} from "../testing/test-support";
import { createEngine } from "./engine";

/**
 * "Move to …" between two computers in one process, each with its own
 * database: A walks a run to its Gate and moves it to B; B takes it over
 * from the archive and walks it on. The peers are those of a computer
 * alone, with an archive both share and each other's Device.
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

const flowOf = (nodes: Flow["nodes"], edges: Flow["edges"] = []): Flow => ({
	version: 5,
	inputs: [],
	outputs: [],
	start: nodes[0]?.id ?? "",
	nodes,
	edges,
});

/** build → gate. The answer ends the run: B needs no Clone. */
const gateFlow = flowOf(
	[command("build", "echo built"), gate],
	[{ id: "e1", from: "build", outcome: "pass", to: "gate" }],
);

const actor = { personId: "the-person" };

const keyOf = (ref: WalkRef) =>
	[ref.kind, ref.spaceId, ref.runId, "stepId" in ref ? ref.stepId : ""].join(
		"/",
	);

let sandboxes: Sandbox[];
/** The archive both computers keep a Space in. */
let archive: Map<string, string>;
beforeEach(() => {
	sandboxes = [];
	archive = new Map();
});
afterEach(async () => {
	for (const s of sandboxes) await s.cleanup();
});

type Computer = Awaited<ReturnType<typeof computer>>;

/** A computer whose peers share `archive`, and see the Devices of `others()` as its owner's. */
async function computer(others: () => OwnDevice[] = () => []) {
	const sandbox = await createSandbox();
	sandboxes.push(sandbox);
	let context: PeerContext | undefined;
	const peers: PeersFactory = (ctx) => {
		context = ctx;
		const alone = alonePeers(ctx);
		return {
			...alone,
			placement: {
				...alone.placement,
				ownDevices: async (spaceId, personId, projectId) => [
					...(await alone.placement.ownDevices(spaceId, personId, projectId)),
					...others(),
				],
			},
			runs: {
				...alone.runs,
				async keepWalk(files) {
					for (const f of files) archive.set(keyOf(f.ref), f.content);
				},
				archived: async (ref) => archive.get(keyOf(ref)) ?? null,
			},
		};
	};
	const engine = createEngine(
		withDevice({
			db: sandbox.db,
			harnesses: { "claude-code": fakeHarness(() => ({})) },
			deviceId: sandbox.deviceId,
			dataDir: sandbox.dataDir,
			scheduler: false,
			peers,
		}),
		{ runLog: createRunLog(sandbox.db, { walkerId: sandbox.deviceId }) },
	);
	if (!context) throw new Error("The engine made no peers.");
	return { sandbox, engine, context };
}

/** `of` as another computer lists it among its owner's Devices. */
const deviceOf = (of: Computer, online = true): OwnDevice => ({
	deviceId: of.sandbox.deviceId,
	name: "laptop",
	thisDevice: false,
	online,
	hasClone: true,
});

/** A and B, each listing the other as one of its owner's Devices. */
async function pair(online = true) {
	let b: Computer | undefined;
	const a = await computer(() => (b ? [deviceOf(b, online)] : []));
	b = await computer(() => [deviceOf(a)]);
	return { a, b };
}

const spaceOf = (on: Computer, from: Computer) =>
	on.engine.space(from.sandbox.spaceId, actor);

/** A starts the flow in its Space and waits until the run waits at the Gate. */
async function waitingOn(a: Computer, flow = gateFlow) {
	const space = spaceOf(a, a);
	const { id: projectId } = await space.addProject({
		repoPath: a.sandbox.repoPath,
	});
	const run = await space.startRun({ projectId, flow });
	await waitFor(async () => (await space.getRun(run.id)).status === "waiting", {
		label: "the run to wait at the Gate",
	});
	return { runId: run.id, projectId };
}

/** B gets A's run rows (and the project row, as the Space document brings it), as the exchange does. */
async function copyRows(a: Computer, b: Computer, projectId: string) {
	const [row] = await a.sandbox.db
		.select()
		.from(project)
		.where(eq(project.id, projectId));
	if (!row) throw new Error("no project");
	await b.sandbox.db.insert(project).values(row).onConflictDoNothing();
	const { rows } = await a.context.history.rowsAfter({
		spaces: [a.sandbox.spaceId],
		cursors: {},
	});
	return b.context.history.ingest(rows);
}

describe("a run that moves to another Device", () => {
	test("leaves its walk state in the archive, and its new Walker walks it on from there", async () => {
		const { a, b } = await pair();
		const { runId, projectId } = await waitingOn(a);
		const before = await spaceOf(a, a).getRun(runId);
		const [build, open] = before.steps.map((s) => s.id) as [string, string];

		await spaceOf(a, a).moveRun(runId, b.sandbox.deviceId);
		const space = a.sandbox.spaceId;
		// Each step's files, then the Checkpoint.
		const kept = [...archive.keys()];
		expect(kept.at(-1)).toBe(`checkpoint/${space}/${runId}/`);
		expect(kept.slice(0, -1).sort()).toEqual(
			[
				`transcript/${space}/${runId}/${build}`,
				`log/${space}/${runId}/${build}`,
				`transcript/${space}/${runId}/${open}`,
			].sort(),
		);
		const onA = await spaceOf(a, a).getRun(runId);
		expect(onA.walker).toMatchObject({
			id: b.sandbox.deviceId,
			thisDevice: false,
		});

		const added = await copyRows(a, b, projectId);
		expect(added.some((e) => e.type === "WalkerMoved")).toBe(true);
		await b.context.takeOver(runId);
		const onB = spaceOf(b, a);
		expect(await onB.getRun(runId)).toMatchObject({
			status: "waiting",
			walker: { id: b.sandbox.deviceId, thisDevice: true },
		});

		await onB.resolveGate({ runId, stepId: open, choice: "approve" });
		await waitFor(async () => (await onB.getRun(runId)).status === "finished", {
			label: "the run to end on B",
		});
		expect(
			(await onB.getRun(runId)).steps.map((s) => [s.nodeId, s.outcome]),
		).toEqual([
			["build", "pass"],
			["gate", "approve"],
		]);
		// A walks it no more: its walk state is empty there.
		expect(await a.context.walks.exportWalk(runId)).toEqual([]);
	});

	test("its new Walker numbers transcript entries after those of the old one", async () => {
		const { a, b } = await pair();
		const { runId, projectId } = await waitingOn(a);
		const steps = (await spaceOf(a, a).getRun(runId)).steps;
		const open = steps[1]?.id as string;
		await spaceOf(a, a).moveRun(runId, b.sandbox.deviceId);
		// B is another computer: the files A wrote are not on its disk.
		await rm(join(a.sandbox.dataDir, "transcripts"), {
			recursive: true,
			force: true,
		});
		await copyRows(a, b, projectId);
		await b.context.takeOver(runId);

		const onB = spaceOf(b, a);
		await onB.resolveGate({ runId, stepId: open, choice: "approve" });
		await waitFor(async () => (await onB.getRun(runId)).status === "finished", {
			label: "the run to end on B",
		});
		const before = steps.flatMap((s) =>
			parseTranscript(
				archive.get(
					keyOf({
						kind: "transcript",
						spaceId: a.sandbox.spaceId,
						runId,
						stepId: s.id,
					}),
				) ?? "",
			),
		);
		const lastOnA = Math.max(...before.map((e) => e.seq));
		expect(lastOnA).toBeGreaterThan(0);
		const [gateRow] = await b.sandbox.db
			.select({ transcriptPath: step.transcriptPath })
			.from(step)
			.where(eq(step.id, open));
		// What B wrote of the Gate's step, its answer, comes after A's part.
		const fromA = before.filter((e) => e.stepId === open).length;
		const written = (
			await readTranscriptFile(gateRow?.transcriptPath as string)
		).slice(fromA);
		expect(written.length).toBeGreaterThan(0);
		expect(written.map((e) => e.seq)).toEqual(
			written.map((_, i) => lastOnA + 1 + i),
		);
	});

	test("the step it waits in keeps what the old Walker wrote of it, on the run page and in what the new Walker archives", async () => {
		const { a, b } = await pair();
		const { runId, projectId } = await waitingOn(a);
		const open = (await spaceOf(a, a).getRun(runId)).steps[1]?.id as string;
		await spaceOf(a, a).moveRun(runId, b.sandbox.deviceId);
		const ref = {
			kind: "transcript" as const,
			spaceId: a.sandbox.spaceId,
			runId,
			stepId: open,
		};
		const before = parseTranscript(archive.get(keyOf(ref)) ?? "");
		expect(before.length).toBeGreaterThan(0);
		// B is another computer: the files A wrote are not on its disk.
		await rm(join(a.sandbox.dataDir, "transcripts"), {
			recursive: true,
			force: true,
		});
		await copyRows(a, b, projectId);
		await b.context.takeOver(runId);

		const onB = spaceOf(b, a);
		await onB.resolveGate({ runId, stepId: open, choice: "approve" });
		await waitFor(async () => (await onB.getRun(runId)).status === "finished", {
			label: "the run to end on B",
		});
		// What B archives of the step once it ended: A's entries, then B's.
		const [file] = (await b.context.walks.exportWalk(runId)).filter(
			(f) => f.ref.kind === "transcript" && f.ref.stepId === open,
		);
		const kept = parseTranscript(file?.content ?? "");
		expect(kept.slice(0, before.length)).toEqual(before);
		expect(kept.length).toBeGreaterThan(before.length);

		// The run page on B shows the step whole.
		const controller = new AbortController();
		const seen: number[] = [];
		const watching = (async () => {
			for await (const item of onB.watchRun(runId, {
				signal: controller.signal,
			})) {
				if (item.kind === "transcript" && item.entry.stepId === open) {
					seen.push(item.entry.seq);
				}
			}
		})();
		await waitFor(() => seen.length >= kept.length, {
			label: "the Gate's step on B's run page",
		}).catch(() => {});
		controller.abort();
		await watching;
		expect(seen).toEqual(kept.map((e) => e.seq));
	});

	test("a second take-over of the same Checkpoint changes nothing", async () => {
		const { a, b } = await pair();
		const { runId, projectId } = await waitingOn(a);
		const open = (await spaceOf(a, a).getRun(runId)).steps[1]?.id as string;
		await spaceOf(a, a).moveRun(runId, b.sandbox.deviceId);
		await copyRows(a, b, projectId);
		await b.context.takeOver(runId);
		await b.context.takeOver(runId);
		const onB = spaceOf(b, a);
		await onB.resolveGate({ runId, stepId: open, choice: "reject" });
		await waitFor(async () => (await onB.getRun(runId)).status === "finished", {
			label: "the run to end on B",
		});
	});

	test("is refused while a step runs, to this computer, to an unknown Device and to one offline", async () => {
		const { a, b } = await pair();
		const space = spaceOf(a, a);
		const { id: projectId } = await space.addProject({
			repoPath: a.sandbox.repoPath,
		});
		const slow = await space.startRun({
			projectId,
			flow: flowOf([command("build", "sleep 2")]),
		});
		await waitFor(async () => (await space.getRun(slow.id)).steps.length > 0, {
			label: "the slow step to start",
		});
		await expect(space.moveRun(slow.id, b.sandbox.deviceId)).rejects.toThrow(
			"The run is in the middle of a step. Move it when it waits, sleeps or has stopped.",
		);
		await space.stopRun(slow.id);

		const { runId } = await waitingOn(a);
		await expect(space.moveRun(runId, a.sandbox.deviceId)).rejects.toThrow(
			"This computer walks the run already.",
		);
		await expect(space.moveRun(runId, "no-such-device")).rejects.toThrow(
			"That device is not one of yours.",
		);
		await expect(
			a.engine.space(a.sandbox.spaceId).moveRun(runId, b.sandbox.deviceId),
		).rejects.toThrow("Sign in to move a run.");
		expect(archive.size).toBe(0);
		await space.stopRun(runId);
	});

	test("is refused to a Device that is offline, and keeps nothing", async () => {
		const { a, b } = await pair(false);
		const { runId } = await waitingOn(a);
		await expect(
			spaceOf(a, a).moveRun(runId, b.sandbox.deviceId),
		).rejects.toThrow("laptop is offline. Move the run when it is online.");
		expect(archive.size).toBe(0);
		await spaceOf(a, a).stopRun(runId);
	});

	test("cannot be taken over without its Checkpoint in the archive", async () => {
		const { a, b } = await pair();
		const { runId, projectId } = await waitingOn(a);
		await copyRows(a, b, projectId);
		await expect(b.context.takeOver(runId)).rejects.toThrow(
			"The archive has no checkpoint of the run.",
		);
		await spaceOf(a, a).stopRun(runId);
	});
});
