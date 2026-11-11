import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "@nightshift/db/schema";
import { eq } from "drizzle-orm";
import { createRunFolders } from "../run-folders/run-folders";
import {
	command,
	drive,
	edge,
	flowOf,
	payloads,
	placementOn,
	startRun,
} from "../testing/graph";
import {
	createSandbox,
	type Sandbox,
	testDevice,
} from "../testing/test-support";

/**
 * The step runner in a run of a project without a folder (ADR 22): a step
 * that works in a folder works in the run folder of its own Device. The
 * run's Device logs its folder, no Device hands its work on, and no step
 * takes a snapshot: a run folder has no git.
 */

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(async () => {
	await sandbox.cleanup();
});

const folderOf = (dataDir: string, runId: string) =>
	join(dataDir, "run-folders", runId);

const FLOW = flowOf(
	[command("one", "pwd"), command("two", "pwd")],
	[edge("e1", "one", "pass", "two")],
);

describe("a step in a run folder", () => {
	test("the first one makes the folder on the run's Device and logs it; none takes a snapshot", async () => {
		const h = await startRun(sandbox, FLOW, { runFolder: true });
		const snapshots: string[] = [];
		const device = testDevice({
			harnesses: {},
			runFolders: createRunFolders(sandbox.dataDir),
		});
		h.ctx.placement = placementOn(() => ({
			...device,
			snapshotWorktree: async ({ cwd }) => {
				snapshots.push(cwd);
				return { tree: "tree" };
			},
			worktreeChanges: async () => ({ tree: "tree-2", files: [] }),
		}));
		const { state } = await drive(h, { inputs: {} });
		expect(state.ended?.status).toBe("finished");
		const folder = folderOf(sandbox.dataDir, h.runId);
		expect(payloads(await h.events(), "WorktreeCreated")).toEqual([
			{ worktreePath: folder, branch: "", baseRef: "" },
		]);
		expect(existsSync(folder)).toBe(true);
		expect(snapshots).toEqual([]);
	});

	test("on another Device, it works in that Device's own folder: no Hand-off", async () => {
		const other = await realpath(
			await mkdtemp(join(tmpdir(), "nightshift-device-b-")),
		);
		try {
			const flow = flowOf(
				[command("here", "pwd"), command("there", "pwd", { device: "b" })],
				[edge("e1", "here", "pass", "there")],
			);
			const h = await startRun(sandbox, flow, { runFolder: true });
			// The plan names B, by its id.
			const deviceNames = JSON.stringify({ b: "studio-b" });
			await sandbox.db
				.update(run)
				.set({ deviceNames })
				.where(eq(run.id, h.runId));
			h.ctx.run = { ...h.ctx.run, deviceNames };
			const handOffs: string[] = [];
			const here = testDevice({
				harnesses: {},
				runFolders: createRunFolders(sandbox.dataDir),
			});
			const onB = testDevice(
				{ harnesses: {}, runFolders: createRunFolders(other) },
				"b",
			);
			h.ctx.placement = placementOn((id) => {
				const device = id === "b" ? { ...onB, name: "studio-b" } : here;
				return {
					...device,
					handOff: async (input) => {
						handOffs.push(input.cwd);
						return device.handOff(input);
					},
				};
			});
			const { state } = await drive(h, { inputs: {} });
			expect(state.ended?.status).toBe("finished");
			const events = await h.events();
			expect(
				payloads(events, "StepEnded").map((p) =>
					String(p.outputs.log_tail).trim(),
				),
			).toEqual([folderOf(sandbox.dataDir, h.runId), folderOf(other, h.runId)]);
			expect(handOffs).toEqual([]);
			expect(events.map((e) => e.type)).not.toContain("HandedOff");
			// Only the run's Device logs its folder.
			expect(payloads(events, "WorktreeCreated")).toHaveLength(1);
		} finally {
			await rm(other, { recursive: true, force: true });
		}
	});

	test("a Device that makes no run folder fails the step and says to update it", async () => {
		const h = await startRun(sandbox, FLOW, { runFolder: true });
		h.ctx.placement = placementOn(() => testDevice({ harnesses: {} }));
		const { state } = await drive(h, { inputs: {} });
		expect(state.ended).toBeNull();
		expect(payloads(await h.events(), "StepEnded")[0]?.error).toBe(
			"test could not make the run's folder. Update Night Shift on test to run projects without a folder.",
		);
	});
});
