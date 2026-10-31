import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type Device, localDevice } from "@nightshift/engine";
import type { RunStatus } from "@nightshift/engine/run-status";
import {
	createSandbox,
	mustGit,
	type Sandbox,
	testKnowledge,
	waitFor,
} from "@nightshift/engine/testing";
import type { Flow } from "@nightshift/flows";
import type { WorkRelay } from "../contract";
import { type PairedReplicas, pairedReplicas } from "../testing";
import { serveWork } from "../work";

/**
 * A Subflow that names a computer, across Replicas: A is the Host and
 * walks the run, B is a Device of its owner with a folder only it has.
 * The Subflow calls `kit:knowledge/folder` on B: its Command runs on B
 * (A's work goes there by a Hand-off), B's reconcile after the step
 * publishes the files to the Space, and A's working copy gets them.
 */

let a: Sandbox;
let b: Sandbox;
let paired: PairedReplicas;
let projectId: string;
/** B as a Device that runs the steps A sends it: made once B is paired. */
let onB: Device | null = null;
const closes: (() => void)[] = [];

beforeEach(async () => {
	[a, b] = await Promise.all([createSandbox(), createSandbox()]);
	const work: WorkRelay = {
		online: (id) => id === b.deviceId,
		async *call(id, request, signal) {
			if (id !== b.deviceId || onB === null) {
				yield { kind: "error", message: "offline", offline: true };
				return;
			}
			yield* serveWork(onB, request, signal ?? new AbortController().signal);
		},
	};
	paired = await pairedReplicas(a, b, { hostWork: work });
	projectId = (
		await paired.host.space(a.spaceId).addProject({ repoPath: a.repoPath })
	).id;
	await paired.projectOnDevice(projectId, { clone: true });
	await paired.hostExchange.addClone(paired.key, {
		spaceId: a.spaceId,
		projectId,
		deviceName: "B",
	});
	// One remote both copies reach, for the Hand-off.
	const remote = join(a.root, "remote.git");
	await mustGit(a.root, ["init", "-q", "--bare", remote]);
	await mustGit(a.repoPath, ["remote", "set-url", "origin", remote]);
	await mustGit(b.repoPath, ["remote", "set-url", "origin", remote]);
	const { knowledge, close } = testKnowledge(b, {
		pageWaitMs: 10_000,
		archive: paired.device.archive,
		synced: paired.synced,
	});
	closes.push(close);
	knowledge.connect({ inStep: async () => {} });
	onB = localDevice({
		id: b.deviceId,
		name: "B",
		harnesses: {},
		knowledge,
		clonePath: async (id) => (id === projectId ? b.repoPath : null),
	});
});

afterEach(async () => {
	for (const close of closes.splice(0)) close();
	onB = null;
	await paired.device.dispose();
	await paired.host.dispose();
	await Promise.all([a, b].map((s) => s.cleanup()));
});

const space = () => paired.host.space(a.spaceId, { personId: paired.personId });

function until(runId: string, status: RunStatus) {
	return waitFor(
		async () => {
			const run = await space().getRun(runId);
			return run.status === status ? run : null;
		},
		{ label: `run ${status}`, timeoutMs: 15_000 },
	);
}

describe("a Subflow that names a computer", () => {
	test("a run A walks syncs a folder of B on B, and the files reach the Space", async () => {
		const notes = join(b.root, "notes");
		await mkdir(notes, { recursive: true });
		await writeFile(join(notes, "plan.md"), "# Plan\n\nOnly on B.\n");

		const started = await space().startRun({
			projectId,
			flow: {
				version: 7,
				inputs: [],
				outputs: [],
				start: "sync",
				nodes: [
					{
						id: "sync",
						type: "call",
						position: { x: 0, y: 0 },
						flow: "kit:knowledge/folder",
						inputs: { path: notes, folder: "notes" },
						device: "B",
					},
				],
				edges: [],
			} as Flow,
			startedBy: paired.personId,
		});
		expect(started.device).toMatchObject({ id: a.deviceId, thisDevice: true });
		const run = await until(started.id, "finished");
		expect(run.steps.map((s) => [s.nodeId, s.outcome, s.device?.id])).toEqual([
			["sync", "pass", b.deviceId],
			["sync", "synced", b.deviceId],
			["synced", "done", b.deviceId],
		]);

		// A's working copy, in step with the Space, has the folder of B.
		const onA = testKnowledge(a, {
			pageWaitMs: 10_000,
			archive: paired.host.archive,
			synced: paired.hostSynced,
		});
		closes.push(onA.close);
		onA.knowledge.connect({ inStep: async () => {} });
		const listing = await onA.knowledge.listing(projectId);
		expect(listing.files.map((f) => f.path)).toEqual(["notes/plan.md"]);
		expect(
			await readFile(join(onA.folder(projectId), "notes/plan.md"), "utf8"),
		).toBe("# Plan\n\nOnly on B.\n");
	}, 30_000);
});
