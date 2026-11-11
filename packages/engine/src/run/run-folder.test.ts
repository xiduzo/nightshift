import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { fakeHarness, reportingScript } from "@nightshift/agents/testing";
import type { AgentHarness } from "@nightshift/agents/types";
import { event } from "@nightshift/db/schema";
import { FLOW_VERSION, type Flow, type FlowNode } from "@nightshift/flows";
import { asc } from "drizzle-orm";
import { createRunLog } from "../log/run-log";
import { createRunFolders } from "../run-folders/run-folders";
import {
	createSandbox,
	type Sandbox,
	waitFor,
	withDevice,
} from "../testing/test-support";
import { createEngine } from "./engine";
import { NO_BRANCHES } from "./run-start";
import type { SpaceEngine } from "./space-engine";

/**
 * A run of a project without a folder (ADR 22), through the engine's
 * public interface: it works in a run folder of its own in the data
 * folder, empty at the start, with no branch and no base. Its steps on
 * other Devices are `@nightshift/devices`' tests (`placement.test.ts`).
 */

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(async () => {
	await sandbox.cleanup();
});

/** The folders the agent's sessions worked in. */
let cwds: string[];

function makeEngine(): SpaceEngine {
	cwds = [];
	const reporting = fakeHarness(reportingScript("pass"));
	const harness: AgentHarness = {
		...reporting,
		run(input) {
			cwds.push(input.cwd);
			return reporting.run(input);
		},
	};
	return createEngine(
		withDevice({
			db: sandbox.db,
			harnesses: { "claude-code": harness },
			deviceId: sandbox.deviceId,
			dataDir: sandbox.dataDir,
		}),
		{
			runLog: createRunLog(sandbox.db, {
				walkerId: sandbox.deviceId,
				dataDir: sandbox.dataDir,
			}),
		},
	).space(sandbox.spaceId);
}

const command = (id: string, line: string): FlowNode => ({
	id,
	type: "command",
	position: { x: 0, y: 0 },
	command: line,
	stdout: "text",
});

const agent = (id: string): FlowNode => ({
	id,
	type: "agent",
	position: { x: 0, y: 0 },
	prompt: "Read the notes.",
	harness: "claude-code",
	model: "sonnet",
	permissionMode: "acceptEdits",
	session: "fresh",
});

function flowOf(nodes: FlowNode[]): Flow {
	return {
		version: FLOW_VERSION,
		inputs: [],
		outputs: [],
		start: nodes[0]?.id ?? "",
		nodes,
		edges: nodes.slice(1).map((node, i) => ({
			id: `e${i}`,
			from: (nodes[i] as FlowNode).id,
			outcome: "pass",
			to: node.id,
		})),
	} as Flow;
}

async function finished(engine: SpaceEngine, runId: string) {
	return waitFor(
		async () => {
			const run = await engine.getRun(runId);
			return run.status === "running" ? null : run;
		},
		{ label: "the run to end" },
	);
}

describe("a run of a project without a folder", () => {
	test("works in its own empty run folder, with no branch and no base", async () => {
		const engine = makeEngine();
		const research = await engine.addProjectWithoutFolder({ name: "Research" });
		const started = await engine.startRun({
			projectId: research.id,
			flow: flowOf([
				command(
					"write",
					'pwd && ls && echo notes > notes.txt && echo "{{run.worktree}}|{{run.branch}}|{{run.base_ref}}"',
				),
				agent("read"),
			]),
		});
		const folder = createRunFolders(sandbox.dataDir).path(started.id);
		expect(started).toMatchObject({
			runFolder: true,
			worktreePath: folder,
			branch: "",
			baseRef: "",
		});
		const run = await finished(engine, started.id);
		expect(run.status).toBe("finished");
		// It started empty: `ls` printed nothing.
		expect(String(run.steps[0]?.outputs.log_tail).trim().split("\n")).toEqual([
			folder,
			`${folder}||`,
		]);
		expect(existsSync(join(folder, "notes.txt"))).toBe(true);
		expect(cwds).toEqual([folder]);
		// The folder is logged once, on the run's Device, and nothing moves.
		const types = (
			await sandbox.db.select().from(event).orderBy(asc(event.seq))
		).map((e) => e.type);
		expect(types.filter((t) => t === "WorktreeCreated")).toHaveLength(1);
		expect(types).not.toContain("HandedOff");
	});

	test("the next run gets a new folder: it does not see the files of the last one", async () => {
		const engine = makeEngine();
		const research = await engine.addProjectWithoutFolder({ name: "Research" });
		const flow = flowOf([command("write", "ls && echo notes > notes.txt")]);
		const first = await engine.startRun({ projectId: research.id, flow });
		await finished(engine, first.id);
		const second = await engine.startRun({ projectId: research.id, flow });
		const run = await finished(engine, second.id);
		expect(second.worktreePath).not.toBe(first.worktreePath);
		expect(String(run.steps[0]?.outputs.log_tail).trim()).toBe("");
	});

	test("a folder that is gone is made again, empty, and the run says so", async () => {
		const engine = makeEngine();
		const research = await engine.addProjectWithoutFolder({ name: "Research" });
		const gate: FlowNode = {
			id: "gate",
			type: "decision",
			position: { x: 0, y: 0 },
			prompt: "Go on?",
			options: [{ name: "pass" }],
			by: "person",
			decider: "typesafe",
		} as FlowNode;
		const started = await engine.startRun({
			projectId: research.id,
			flow: flowOf([
				command("write", "echo notes > notes.txt"),
				gate,
				command("read", "ls"),
			]),
		});
		const waiting = await waitFor(
			async () => {
				const run = await engine.getRun(started.id);
				return run.status === "waiting" ? run : null;
			},
			{ label: "the Gate" },
		);
		// Someone removed the folder while the run waited.
		await rm(started.worktreePath, { recursive: true });
		const stepId = waiting.steps.find((s) => s.nodeId === "gate")?.id ?? "";
		await engine.act(started.id, { kind: "answer", stepId, choice: "pass" });
		const run = await finished(engine, started.id);
		expect(run.status).toBe("finished");
		expect(String(run.steps.at(-1)?.outputs.log_tail).trim()).toBe("");
		expect(existsSync(started.worktreePath)).toBe(true);
		expect(run.warnings.map((w) => w.message)).toContain(
			"The folder of this run on test was gone. Night Shift made a new, empty one.",
		);
	});

	test("its schedules save with no Clone, and Run now starts in a run folder", async () => {
		const engine = makeEngine();
		const research = await engine.addProjectWithoutFolder({ name: "Research" });
		await engine.flows.save(
			research.id,
			"watch",
			flowOf([command("look", "pwd")]),
		);
		expect(
			await engine.saveSchedules(research.id, [
				{
					id: "s1",
					flow: "watch",
					cron: "0 6 * * *",
					enabled: true,
					inputs: {},
				},
			]),
		).toEqual([]);
		const started = await engine.runScheduleNow(research.id, "s1");
		const run = await finished(engine, started.id);
		expect(run.status).toBe("finished");
		expect(String(run.steps[0]?.outputs.log_tail).trim()).toBe(
			createRunFolders(sandbox.dataDir).path(started.id),
		);
	});

	test("a base is refused: the project has no branches", async () => {
		const engine = makeEngine();
		const research = await engine.addProjectWithoutFolder({ name: "Research" });
		await expect(
			engine.startRun({
				projectId: research.id,
				flow: flowOf([command("write", "true")]),
				baseRef: "main",
			}),
		).rejects.toThrow(NO_BRANCHES);
		expect(await engine.listRuns()).toEqual([]);
	});
});
