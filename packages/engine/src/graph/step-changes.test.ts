import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "@langchain/langgraph";
import { fakeHarness, reportingScript } from "@nightshift/agents/testing";
import type { JoinNode } from "@nightshift/flows";
import { localDevice } from "../device/local";
import type { StepEvent, WorktreeChanges } from "../log";
import { foldRun } from "../log";
import { readTranscriptFile } from "../log/transcripts";
import { deriveSteps } from "../read";
import {
	agent,
	command,
	drive,
	edge,
	flowOf,
	type Harness,
	payloads,
	startRun,
} from "../testing/graph";
import {
	createSandbox,
	type Sandbox,
	TEST_DEVICE_ID,
} from "../testing/test-support";
import { activeBetween } from "./step-changes";

/**
 * What a step changed in the run's worktree (`step-changes.ts`), on the
 * compiled graph with a real git: the snapshot before the body, the
 * changes before the step ends or pauses, the first snapshot kept across
 * a reopen, a snapshot that fails, and parallel branches that share the
 * worktree.
 */

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(async () => {
	await sandbox.cleanup();
});

/** The run's Device takes snapshots: as the daemon's does. */
async function withSnapshots(h: Harness): Promise<Harness> {
	h.local.snapshots = true;
	return h;
}

async function transcriptOf(h: Harness, nodeId: string): Promise<StepEvent[]> {
	const found = deriveSteps(foldRun(await h.events())).find(
		(s) => s.nodeId === nodeId,
	);
	const entries = await readTranscriptFile(found?.transcriptPath as string);
	return entries.map((entry) => entry.event);
}

type ChangesEvent = Extract<StepEvent, { type: "worktree-changes" }>;
const changesIn = (events: StepEvent[]): ChangesEvent[] =>
	events.filter((e): e is ChangesEvent => e.type === "worktree-changes");

describe("what a step changed in the worktree", () => {
	test("a Command step records a snapshot, then every file it changed with its diff, before it ends", async () => {
		const h = await withSnapshots(
			await startRun(
				sandbox,
				flowOf([command("gen", "printf 'made\\n' > made.txt && rm README.md")]),
			),
		);
		await drive(h, { inputs: {} });

		const events = await transcriptOf(h, "gen");
		expect(events.map((e) => e.type)).toEqual([
			"worktree-snapshot",
			"command-start",
			"command-exit",
			"worktree-changes",
		]);
		const [snapshot] = events;
		const [changes] = changesIn(events);
		expect(changes).toEqual({
			type: "worktree-changes",
			from: snapshot?.type === "worktree-snapshot" ? snapshot.tree : "",
			to: expect.stringMatching(/^[0-9a-f]+$/),
			files: [
				{
					path: "README.md",
					status: "deleted",
					added: 0,
					removed: 1,
					patch: "@@ -1 +0,0 @@\n-# test repo",
				},
				{
					path: "made.txt",
					status: "added",
					added: 1,
					removed: 0,
					patch: "@@ -0,0 +1 @@\n+made",
				},
			],
		});
		expect(payloads(await h.events(), "StepEnded")[0]?.outcome).toBe("pass");
	});

	test("a step that changed nothing records its snapshot only", async () => {
		const h = await withSnapshots(
			await startRun(sandbox, flowOf([command("look", "ls > /dev/null")])),
		);
		await drive(h, { inputs: {} });
		expect((await transcriptOf(h, "look")).map((e) => e.type)).toEqual([
			"worktree-snapshot",
			"command-start",
			"command-exit",
		]);
	});

	test("a Device that takes no snapshots, or one that fails, never fails the step", async () => {
		const h = await startRun(
			sandbox,
			flowOf([command("gen", "echo hi > made.txt")]),
		);
		const broken = () => ({
			...localDevice({ id: TEST_DEVICE_ID, name: "test", ...h.local }),
			snapshotWorktree: async (): Promise<{ tree: string }> => {
				throw new Error("No git here.");
			},
			worktreeChanges: async (): Promise<WorktreeChanges> => {
				throw new Error("No git here.");
			},
		});
		h.ctx.deviceFor = broken;
		h.ctx.deviceById = broken;
		await drive(h, { inputs: {} });

		expect(payloads(await h.events(), "StepEnded")[0]?.outcome).toBe("pass");
		expect((await transcriptOf(h, "gen")).map((e) => e.type)).toEqual([
			"command-start",
			"command-exit",
		]);
	});

	test("an Agent that asks a person records what it changed so far; after the answer, its changes count from its first snapshot", async () => {
		const repo = sandbox.repoPath;
		// Each session changes a file as a shell command would, outside any edit tool.
		const harness = fakeHarness((_input, call) => {
			if (call === 0) {
				writeFileSync(join(repo, "asked.txt"), "first\n");
				return reportingScript("needs-input", "Which one?");
			}
			writeFileSync(join(repo, "answered.txt"), "second\n");
			return reportingScript("pass", "Done.");
		});
		const h = await withSnapshots(
			await startRun(
				sandbox,
				flowOf({
					start: "worker",
					nodes: [agent("worker", "Do it", { ask: "person" })],
					edges: [],
				}),
				{ harness },
			),
		);
		await drive(h, { inputs: {} });
		const asked = changesIn(await transcriptOf(h, "worker"));
		expect(asked.map((c) => c.files.map((f) => f.path))).toEqual([
			["asked.txt"],
		]);

		await drive(
			h,
			new Command({
				resume: { kind: "gate", choice: "answer", note: "This one." },
			}),
			h.graph(),
		);
		const events = await transcriptOf(h, "worker");
		expect(events.filter((e) => e.type === "worktree-snapshot")).toHaveLength(
			1,
		);
		const all = changesIn(events);
		expect(all).toHaveLength(2);
		expect(all[1]?.from).toBe(all[0]?.from as string);
		expect(all[1]?.files.map((f) => f.path)).toEqual([
			"answered.txt",
			"asked.txt",
		]);
	});

	test("parallel branches share the worktree: a step that ran beside another says so", async () => {
		const joinNode: JoinNode = {
			id: "joined",
			type: "join",
			position: { x: 0, y: 0 },
			wait: "all",
		};
		const h = await withSnapshots(
			await startRun(
				sandbox,
				flowOf(
					[
						command("start", "true"),
						command("slow", "sleep 0.4 && echo slow > slow.txt"),
						command("quick", "echo quick > quick.txt"),
						joinNode,
					],
					[
						edge("start-slow", "start", "pass", "slow"),
						edge("start-quick", "start", "pass", "quick"),
						edge("slow-joined", "slow", "pass", "joined"),
						edge("quick-joined", "quick", "pass", "joined"),
					],
				),
			),
		);
		await drive(h, { inputs: {} });

		const [slow] = changesIn(await transcriptOf(h, "slow"));
		const [quick] = changesIn(await transcriptOf(h, "quick"));
		// The slow step's list holds the quick one's file too.
		expect(slow?.files.map((f) => f.path)).toEqual(["quick.txt", "slow.txt"]);
		expect(slow?.overlapped).toBe(true);
		expect(quick?.overlapped).toBe(true);
	});
});

describe("activeBetween", () => {
	const step = (extra: Partial<Parameters<typeof activeBetween>[0]> = {}) => ({
		startedAt: 10,
		endedAt: 20,
		sleeps: [],
		gateWaits: [],
		...extra,
	});

	test("an open or ended step is active in the time it overlaps", () => {
		expect(activeBetween(step(), 0, 5)).toBe(false);
		expect(activeBetween(step(), 25, 30)).toBe(false);
		expect(activeBetween(step(), 15, 30)).toBe(true);
		expect(activeBetween(step({ endedAt: null }), 25, 30)).toBe(true);
	});

	test("a step asleep or at a Gate the whole time was not active", () => {
		const asleep = step({
			endedAt: null,
			sleeps: [{ from: 12, to: null, reason: "duration", signal: null }],
		});
		expect(activeBetween(asleep, 15, 30)).toBe(false);
		expect(activeBetween(asleep, 11, 30)).toBe(true);
		const atGate = step({
			sleeps: [{ from: 10, to: 14, reason: "duration", signal: null }],
			gateWaits: [{ from: 14, to: 20 }],
		});
		expect(activeBetween(atGate, 0, 30)).toBe(false);
	});
});
