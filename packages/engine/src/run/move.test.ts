import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { fakeHarness } from "@nightshift/agents/testing";
import { project } from "@nightshift/db/schema";
import type {
	CommandNode,
	DecisionNode,
	Flow,
	WaitNode,
} from "@nightshift/flows";
import { eq } from "drizzle-orm";
import type { OwnDevice } from "../contract";
import type { WalkFile, WalkRef } from "../graph/walk-state";
import { createRunLog } from "../log/run-log";
import {
	parseTranscript,
	readTranscriptFile,
	transcriptPath,
} from "../log/transcripts";
import { alonePeers } from "../testing/alone-peers";
import {
	createSandbox,
	type Sandbox,
	waitFor,
	withDevice,
} from "../testing/test-support";
import { createEngine } from "./engine";
import type { PeerContext, PeersFactory } from "./peers";

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
	version: 6,
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
/** The stamps of the files in `archive`. */
let stamps: Map<string, WalkFile["stamp"]>;
beforeEach(() => {
	sandboxes = [];
	archive = new Map();
	stamps = new Map();
});
afterEach(async () => {
	for (const s of sandboxes) await s.cleanup();
});

type Computer = Awaited<ReturnType<typeof computer>>;

/** A computer whose peers share `archive`, and see the Devices of `others()` as its owner's. */
async function computer(
	others: () => OwnDevice[] = () => [],
	/** A computer's database to start on again: a restart. Default: a new one. */
	again?: Sandbox,
) {
	const sandbox = again ?? (await createSandbox());
	if (!again) sandboxes.push(sandbox);
	let context: PeerContext | undefined;
	const peers: PeersFactory = (ctx) => {
		context = ctx;
		const alone = alonePeers(ctx);
		return {
			...alone,
			placement: {
				...alone.placement,
				// The planner's answer (`PlacementPort.moveTo`): one of the
				// others, refused while it is offline.
				async moveTo(_row, _actor, to) {
					const target = others().find((d) => d.deviceId === to);
					if (!target) return null;
					if (!target.online) throw new Error("The planner refuses it.");
					return { id: target.deviceId, name: target.name };
				},
				devicesFor: async (spaceId, personId, projectId, forNode) => [
					...(await alone.placement.devicesFor(
						spaceId,
						personId,
						projectId,
						forNode,
					)),
					...others(),
				],
			},
			runs: {
				...alone.runs,
				async keepWalk(files) {
					for (const f of files) {
						archive.set(keyOf(f.ref), f.content);
						stamps.set(keyOf(f.ref), f.stamp);
					}
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

/** B gets A's run rows in the Space (A's own by default) and the project row (as the Space document brings it), as the exchange does. */
async function copyRows(
	a: Computer,
	b: Computer,
	projectId: string,
	spaceId = a.sandbox.spaceId,
) {
	const [row] = await a.sandbox.db
		.select()
		.from(project)
		.where(eq(project.id, projectId));
	if (!row) throw new Error("no project");
	await b.sandbox.db.insert(project).values(row).onConflictDoNothing();
	const { rows } = await a.context.history.rowsAfter({
		spaces: [spaceId],
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

	test("its new Walker stamps each step's copy as the old one did, and the Gate's with its end once answered", async () => {
		const { a, b } = await pair();
		const { runId, projectId } = await waitingOn(a);
		const [build, open] = (await spaceOf(a, a).getRun(runId)).steps.map(
			(s) => s.id,
		) as [string, string];
		await spaceOf(a, a).moveRun(runId, b.sandbox.deviceId);
		const transcript = (stepId: string): WalkRef => ({
			kind: "transcript",
			spaceId: a.sandbox.spaceId,
			runId,
			stepId,
		});
		expect(stamps.get(keyOf(transcript(build)))).toEqual({
			opening: 1,
			ended: true,
		});
		// The Gate waits: its copy is of a step that runs.
		expect(stamps.get(keyOf(transcript(open)))).toEqual({
			opening: 1,
			ended: false,
		});

		await copyRows(a, b, projectId);
		await b.context.takeOver(runId);
		/** The stamp of a step's transcript as B exports it. */
		const onB = async (stepId: string) =>
			(await b.context.walks.exportWalk(runId)).find(
				(f) => keyOf(f.ref) === keyOf(transcript(stepId)),
			)?.stamp;
		// From B's log: the same stamps, wherever the run's events came from.
		expect(await onB(build)).toEqual(stamps.get(keyOf(transcript(build))));
		expect(await onB(open)).toEqual(stamps.get(keyOf(transcript(open))));

		await spaceOf(b, a).resolveGate({ runId, stepId: open, choice: "approve" });
		await waitFor(
			async () => (await spaceOf(b, a).getRun(runId)).status === "finished",
			{ label: "the run to end on B" },
		);
		expect(await onB(open)).toEqual({ opening: 1, ended: true });
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
		// What B wrote of the Gate's step, its answer, comes after A's part.
		const fromA = before.filter((e) => e.stepId === open).length;
		const written = (
			await readTranscriptFile(transcriptPath(b.sandbox.dataDir, runId, open))
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

	test("its new Walker writes a step's transcript in its own data folder", async () => {
		const { a, b } = await pair();
		const { runId, projectId } = await waitingOn(a);
		const open = (await spaceOf(a, a).getRun(runId)).steps[1]?.id as string;
		const onA = transcriptPath(a.sandbox.dataDir, runId, open);
		const fromA = await readTranscriptFile(onA);
		expect(fromA.length).toBeGreaterThan(0);
		await spaceOf(a, a).moveRun(runId, b.sandbox.deviceId);
		await copyRows(a, b, projectId);
		await b.context.takeOver(runId);

		const onB = spaceOf(b, a);
		await onB.resolveGate({ runId, stepId: open, choice: "approve" });
		await waitFor(async () => (await onB.getRun(runId)).status === "finished", {
			label: "the run to end on B",
		});
		// The rows B got name A's data folder. B writes in its own.
		const ownFile = await readTranscriptFile(
			transcriptPath(b.sandbox.dataDir, runId, open),
		);
		expect(ownFile.slice(0, fromA.length)).toEqual(fromA);
		expect(ownFile.length).toBeGreaterThan(fromA.length);
		expect(await readTranscriptFile(onA)).toEqual(fromA);
	});

	test("moved back, its first Walker keeps what the other one wrote of a step", async () => {
		const twoGates = flowOf(
			[
				command("build", "echo built"),
				gate,
				{ ...gate, id: "again", prompt: "Really?" },
			],
			[
				{ id: "e1", from: "build", outcome: "pass", to: "gate" },
				{ id: "e2", from: "gate", outcome: "approve", to: "again" },
			],
		);
		const { a, b } = await pair();
		const { runId, projectId } = await waitingOn(a, twoGates);
		const first = (await spaceOf(a, a).getRun(runId)).steps[1]?.id as string;
		await spaceOf(a, a).moveRun(runId, b.sandbox.deviceId);
		await copyRows(a, b, projectId);
		await b.context.takeOver(runId);
		const onB = spaceOf(b, a);
		await onB.resolveGate({ runId, stepId: first, choice: "approve" });
		await waitFor(async () => (await onB.getRun(runId)).steps.length === 3, {
			label: "the second Gate on B",
		});
		await waitFor(async () => (await onB.getRun(runId)).status === "waiting", {
			label: "the run to wait on B",
		});
		const onBFile = await readTranscriptFile(
			transcriptPath(b.sandbox.dataDir, runId, first),
		);

		await onB.moveRun(runId, a.sandbox.deviceId);
		await copyRows(b, a, projectId, a.sandbox.spaceId);
		await a.context.takeOver(runId);
		// A's own file of the step had only A's part: now it has B's too.
		expect(
			await readTranscriptFile(transcriptPath(a.sandbox.dataDir, runId, first)),
		).toEqual(onBFile);
		const second = (await spaceOf(a, a).getRun(runId)).steps[2]?.id as string;
		await spaceOf(a, a).resolveGate({
			runId,
			stepId: second,
			choice: "reject",
		});
		await waitFor(
			async () => (await spaceOf(a, a).getRun(runId)).status === "finished",
			{ label: "the run to end on A" },
		);
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
		).rejects.toThrow("Sign in to act on this run.");
		expect(archive.size).toBe(0);
		await space.stopRun(runId);
	});

	test("can go to the owner's other Devices that are online, never to its own Walker", async () => {
		const { a, b } = await pair();
		const { runId } = await waitingOn(a);
		const targets = async () =>
			(await spaceOf(a, a).listMoveTargets(runId)).map((d) => d.deviceId);
		expect(await targets()).toEqual([b.sandbox.deviceId]);

		// B walks it now: it can come back to this computer.
		await spaceOf(a, a).moveRun(runId, b.sandbox.deviceId);
		expect(await targets()).toEqual([a.sandbox.deviceId]);
		// A run of another Space is not found there.
		await expect(
			a.engine.space("another-space", actor).listMoveTargets(runId),
		).rejects.toThrow("Night Shift cannot find this run.");
	});

	test("has no target while the owner's other Device is offline", async () => {
		const { a } = await pair(false);
		const { runId } = await waitingOn(a);
		expect(await spaceOf(a, a).listMoveTargets(runId)).toEqual([]);
		await spaceOf(a, a).stopRun(runId);
	});

	test("is refused when the planner refuses its Device, and keeps nothing", async () => {
		const { a, b } = await pair(false);
		const { runId } = await waitingOn(a);
		await expect(
			spaceOf(a, a).moveRun(runId, b.sandbox.deviceId),
		).rejects.toThrow("The planner refuses it.");
		expect(archive.size).toBe(0);
		await spaceOf(a, a).stopRun(runId);
	});

	test("a sleeping run that arrived gets its timer back after a restart of its new Walker", async () => {
		const { a, b } = await pair();
		const pause: WaitNode = {
			id: "pause",
			type: "wait",
			position: { x: 0, y: 0 },
			until: { kind: "time", at: new Date(Date.now() + 4_000).toISOString() },
		};
		const space = spaceOf(a, a);
		const { id: projectId } = await space.addProject({
			repoPath: a.sandbox.repoPath,
		});
		const { id: runId } = await space.startRun({
			projectId,
			flow: flowOf([pause]),
		});
		await waitFor(
			async () => (await space.getRun(runId)).status === "sleeping",
			{ label: "the run to sleep" },
		);
		await space.moveRun(runId, b.sandbox.deviceId);
		await copyRows(a, b, projectId);
		await b.context.takeOver(runId);
		// B restarts before the wake: the next engine's recovery sets the timer.
		await b.engine.dispose();
		const again = await computer(() => [deviceOf(a)], b.sandbox);
		await waitFor(
			async () => (await spaceOf(again, a).getRun(runId)).status === "finished",
			{ label: "the run to wake and end on B", timeoutMs: 15_000 },
		);
		await again.engine.dispose();
	});

	test("refuses every action on its new Walker until it arrived, then takes them", async () => {
		const { a, b } = await pair();
		const { runId, projectId } = await waitingOn(a);
		const open = (await spaceOf(a, a).getRun(runId)).steps.at(-1)?.id ?? "";
		await spaceOf(a, a).moveRun(runId, b.sandbox.deviceId);
		await copyRows(a, b, projectId);
		const onB = spaceOf(b, a);
		const before = await b.context.log.events(runId);

		// B walks it now, but has no Checkpoint of it yet.
		const arriving =
			"This run is still on its way to this computer. Try again in a moment.";
		await expect(
			onB.resolveGate({ runId, stepId: open, choice: "approve" }),
		).rejects.toThrow(arriving);
		await expect(onB.resumeRun(runId)).rejects.toThrow(arriving);
		await expect(onB.stopRun(runId, { when: "after-step" })).rejects.toThrow(
			arriving,
		);
		expect(await b.context.log.events(runId)).toEqual(before);

		await b.context.takeOver(runId);
		await onB.resolveGate({ runId, stepId: open, choice: "approve" });
		await waitFor(async () => (await onB.getRun(runId)).status === "finished", {
			label: "the run to end on B",
		});
	});

	test("cannot be taken over without its Checkpoint in the archive, and arrives once it is there", async () => {
		const { a, b } = await pair();
		const { runId, projectId } = await waitingOn(a);
		await spaceOf(a, a).moveRun(runId, b.sandbox.deviceId);
		const kept = new Map(archive);
		archive.clear();
		await copyRows(a, b, projectId);
		const here = [b.sandbox.deviceId];
		await expect(b.context.takeOver(runId)).rejects.toThrow(
			"The archive has no checkpoint of the run.",
		);
		// Nothing says it arrived: the take-over is tried again.
		expect(await b.context.history.arriving(here)).toEqual([runId]);
		for (const [key, content] of kept) archive.set(key, content);
		await b.context.takeOver(runId);
		expect(await b.context.history.arriving(here)).toEqual([]);
		expect((await b.context.log.events(runId)).at(-1)).toMatchObject({
			type: "WalkerArrived",
			payload: { from: a.sandbox.deviceId },
		});
	});
});
