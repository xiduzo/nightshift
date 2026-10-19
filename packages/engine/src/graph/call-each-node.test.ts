import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Command } from "@langchain/langgraph";
import type { AgentSessionInput } from "@nightshift/agents";
import {
	fakeHarness,
	reportingScript,
	usageLimitScript,
} from "@nightshift/agents/fake";
import type { CallEach, CallEachNode, CallNode, Flow } from "@nightshift/flows";

import { type DerivedStep, deriveSteps } from "../events";
import { defaultRunSettings } from "../settings";
import { createSandbox, mustGit, type Sandbox } from "../test-support";
import { readTranscriptFile } from "../transcripts";
import { itemBranchName } from "../worktrees";
import { DEFAULT_RESUME_PROMPT } from "./context";
import {
	agent,
	command,
	drive,
	edge,
	flowOf,
	type Harness,
	payloads,
	startRun,
} from "./test-support";

/**
 * The Call node with `each` on the compiled graph: one element per super-step,
 * the body as a subgraph per element. The event log, the transcript and
 * the outputs are compared with what the engine writes today for the same
 * situations (call-each.test.ts "Call with each", flows-v2.test.ts).
 */

const RUN_BRANCH = "nightshift/test";

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
	// The run's worktree is checked out on the run's branch, as a real one is.
	await mustGit(sandbox.repoPath, ["checkout", "-q", "-b", RUN_BRANCH]);
});
afterEach(async () => {
	await sandbox.cleanup();
});

/** A Call node with `each`: `extra` fills `each`, except `inputs` and `timeoutMinutes`. */
const callEach = (
	id: string,
	flow: string,
	source: CallEach["source"],
	extra: Partial<CallEach> &
		Partial<Pick<CallNode, "inputs" | "timeoutMinutes">> = {},
): CallEachNode => {
	const { inputs, timeoutMinutes, ...each } = extra;
	return {
		id,
		type: "call",
		position: { x: 0, y: 0 },
		flow,
		inputs: inputs ?? {},
		...(timeoutMinutes === undefined ? {} : { timeoutMinutes }),
		each: { source, as: "item", branch: "per-item", haltOn: ["halt"], ...each },
	};
};

const json = (items: unknown[]): CallEach["source"] => ({
	kind: "json",
	value: JSON.stringify(items),
});

/** A called flow with the input `item`. */
const body = (
	nodes: Flow["nodes"],
	edges: Flow["edges"] = [],
	extra: Partial<Flow> = {},
): Flow =>
	flowOf(nodes, edges, {
		inputs: [{ name: "item", type: "json", required: true }],
		...extra,
	});

/** Commits a file named after the item, so the worktree is clean for the next item. */
const commitItem = `echo "{{run.branch}}" > "item-{{item.id}}.txt" && git add -A && git -c user.name=t -c user.email=t@nightshift.invalid -c commit.gpgsign=false commit -q -m "item {{item.id}}"`;

const loopStep = (steps: DerivedStep[], nodeId = "loop"): DerivedStep => {
	const found = steps.find((s) => s.nodeId === nodeId && s.nodeType === "call");
	if (!found) throw new Error(`No Call step ${nodeId}`);
	return found;
};

const itemTypes = async (h: Harness) =>
	(await h.types()).filter((t) => t.startsWith("Item"));

describe("the Call node with each", () => {
	test("runs the body per element, blockers first, each on a branch stacked on the last done one; the log, the transcript, the outputs and the state", async () => {
		const build = body(
			[agent("worker", "Build {{item.title}}"), command("commit", commitItem)],
			[edge("b1", "worker", "pass", "commit")],
		);
		const harness = fakeHarness();
		const h = await startRun(
			sandbox,
			flowOf([
				callEach(
					"loop",
					"build",
					json([
						{ id: "1", title: "first listed", blockedBy: ["2"] },
						{ id: "2", title: "its blocker" },
						{ id: "3", title: "done already", done: true },
					]),
				),
			]),
			{ harness, flows: { build } },
		);
		const { parked, state, next, events } = await drive(h, { inputs: {} });
		expect(parked).toEqual([]);
		expect(next).toEqual([]);
		expect(harness.calls.map((c) => c.prompt)).toEqual([
			"Build its blocker",
			"Build first listed",
		]);
		expect(state.ended).toEqual({
			status: "finished",
			nodeId: "loop",
			outcome: "done",
			reason: null,
		});
		expect(state.loops).toEqual({ loop: null });
		expect(state.visits).toEqual({ loop: 1 });

		const logged = await h.events();
		const steps = deriveSteps(logged);
		const loop = loopStep(steps);
		expect(loop.outcome).toBe("done");
		expect(loop.scope).toBeNull();
		expect(loop.items.map((i) => [i.facts.id, i.state])).toEqual([
			["2", "done"],
			["1", "done"],
		]);
		const short = h.runId.slice(0, 8);
		const [second, first] = loop.items;
		expect(second?.branch).toBe(
			itemBranchName(short, { id: "2", title: "its blocker" }),
		);
		expect(second?.baseBranch).toBe(RUN_BRANCH);
		expect(first?.branch).toBe(
			itemBranchName(short, { id: "1", title: "first listed" }),
		);
		expect(first?.baseBranch).toBe(second?.branch ?? "");
		expect(loop.outputs).toEqual({
			outcome: "done",
			done_count: 2,
			failed_count: 0,
			blocked_count: 0,
			waiting_count: 0,
			summary: "#2 done\n#1 done",
			results: [
				{
					id: "2",
					title: "its blocker",
					state: "done",
					reason: null,
					outputs: {},
				},
				{
					id: "1",
					title: "first listed",
					state: "done",
					reason: null,
					outputs: {},
				},
			],
			visit: 1,
		});
		expect(state.nodes.loop).toEqual(loop.outputs as Record<string, unknown>);

		// The event payloads, as the engine writes them.
		expect(payloads(logged, "StepStarted")[0]).toMatchObject({
			nodeId: "loop",
			nodeType: "call",
			visit: 1,
			logPath: null,
			scope: null,
		});
		expect(payloads(logged, "ItemsRead")).toEqual([
			{ count: 3, open: 2 },
			{ count: 3, open: 1 },
			{ count: 3, open: 0 },
		]);
		expect(payloads(logged, "ItemStarted")).toEqual([
			{
				item: {
					id: "2",
					title: "its blocker",
					url: null,
					value: { id: "2", title: "its blocker" },
				},
				index: 1,
				branch: second?.branch as string,
				baseBranch: RUN_BRANCH,
				inputs: { item: { id: "2", title: "its blocker" } },
			},
			{
				item: {
					id: "1",
					title: "first listed",
					url: null,
					value: { id: "1", title: "first listed", blockedBy: ["2"] },
				},
				index: 2,
				branch: first?.branch as string,
				baseBranch: second?.branch as string,
				inputs: { item: { id: "1", title: "first listed", blockedBy: ["2"] } },
			},
		]);
		expect(payloads(logged, "ItemEnded")).toEqual([
			{ itemId: "2", state: "done", reason: null, outputs: {} },
			{ itemId: "1", state: "done", reason: null, outputs: {} },
		]);
		expect(await itemTypes(h)).toEqual([
			"ItemsRead",
			"ItemStarted",
			"ItemEnded",
			"ItemsRead",
			"ItemStarted",
			"ItemEnded",
			"ItemsRead",
		]);
		expect(logged.filter((e) => e.type === "StepEnded").at(-1)?.stepId).toBe(
			loop.id,
		);

		// The stack: item 1's commit sits on top of item 2's.
		const wt = sandbox.repoPath;
		expect(await mustGit(wt, ["rev-parse", `${first?.branch}^`])).toBe(
			await mustGit(wt, ["rev-parse", `${second?.branch}`]),
		);
		expect(await mustGit(wt, ["rev-parse", `${second?.branch}^`])).toBe(
			await mustGit(wt, ["rev-parse", RUN_BRANCH]),
		);
		// {{run.branch}} reached the body's command.
		expect(await mustGit(wt, ["show", `${first?.branch}:item-1.txt`])).toBe(
			first?.branch ?? "",
		);

		// Body steps run in the scope of their item.
		const bodySteps = steps.filter((s) => s.scope !== null);
		expect(bodySteps.map((s) => [s.nodeId, s.scope?.itemId, s.visit])).toEqual([
			["worker", "2", 1],
			["commit", "2", 1],
			["worker", "1", 1],
			["commit", "1", 1],
		]);
		expect(new Set(bodySteps.map((s) => s.scope?.parentStepId))).toEqual(
			new Set([loop.id]),
		);
		expect(payloads(logged, "EdgeTaken").map((e) => e.scope)).toEqual([
			{ parentStepId: loop.id, itemId: "2" },
			{ parentStepId: loop.id, itemId: "1" },
		]);

		// The transcript of the For Each step.
		const transcript = await readTranscriptFile(loop.transcriptPath);
		expect(transcript.map((e) => e.event.type)).toEqual([
			"items-read",
			"item-start",
			"item-end",
			"items-read",
			"item-start",
			"item-end",
			"items-read",
		]);
		expect(transcript[0]?.event).toEqual({
			type: "items-read",
			count: 3,
			open: 2,
		});
		expect(transcript[1]?.event).toEqual({
			type: "item-start",
			itemId: "2",
			title: "its blocker",
			branch: second?.branch as string,
			baseBranch: RUN_BRANCH,
		});
		expect(transcript[2]?.event).toEqual({
			type: "item-end",
			itemId: "2",
			state: "done",
			reason: null,
		});
		expect(transcript.map((e) => e.stepId)).toEqual(
			transcript.map(() => loop.id),
		);
		// Every transcript entry of the run reached the custom stream.
		expect(events.filter((e) => e.type === "transcript")).toHaveLength(
			transcript.length +
				(
					await Promise.all(
						bodySteps.map((s) => readTranscriptFile(s.transcriptPath)),
					)
				).reduce((n, t) => n + t.length, 0),
		);
	});

	test("without a branch per element, all elements share the checked-out branch", async () => {
		const build = body([command("commit", commitItem)]);
		const h = await startRun(
			sandbox,
			flowOf([
				callEach(
					"loop",
					"build",
					json([
						{ id: "1", title: "a" },
						{ id: "2", title: "b" },
					]),
					{ branch: "shared" },
				),
			]),
			{ harness: fakeHarness(), flows: { build } },
		);
		const { state } = await drive(h, { inputs: {} });
		expect(state.ended?.outcome).toBe("done");
		const loop = loopStep(deriveSteps(await h.events()));
		expect(loop.items.map((i) => [i.branch, i.baseBranch])).toEqual([
			[null, null],
			[null, null],
		]);
		const wt = sandbox.repoPath;
		expect(await mustGit(wt, ["branch", "--show-current"])).toBe(RUN_BRANCH);
		expect(await mustGit(wt, ["show", "HEAD:item-2.txt"])).toBe(RUN_BRANCH);
		expect(await mustGit(wt, ["show", "HEAD^:item-1.txt"])).toBe(RUN_BRANCH);
	});

	test("a failed element blocks its dependents, and the loop goes on with free work", async () => {
		const build = body([
			command("check", `test "{{item.id}}" != 1 && ${commitItem}`),
		]);
		const h = await startRun(
			sandbox,
			flowOf(
				[
					callEach(
						"loop",
						"build",
						json([
							{ id: "1", title: "fails" },
							{ id: "2", title: "waits on 1", blockedBy: ["1"] },
							{ id: "4", title: "waits on 2", blockedBy: ["2"] },
							{ id: "3", title: "free" },
						]),
					),
					command("after", `echo "{{loop.summary}}"`),
				],
				[edge("e1", "loop", "done", "after")],
			),
			{ harness: fakeHarness(), flows: { build } },
		);
		const { parked, state } = await drive(h, { inputs: {} });
		// The body's park at "check" never reached the root.
		expect(parked).toEqual([]);
		expect(state.ended?.nodeId).toBe("after");
		const logged = await h.events();
		const steps = deriveSteps(logged);
		const loop = loopStep(steps);
		const reason =
			'Node "check" ended with "fail" and no edge leaves it on that outcome.';
		expect(loop.items.map((i) => [i.facts.id, i.state, i.reason])).toEqual([
			["1", "failed", reason],
			["2", "blocked", "blocked by #1"],
			["4", "blocked", "blocked by #2"],
			["3", "done", null],
		]);
		expect(loop.outputs).toMatchObject({
			outcome: "done",
			done_count: 1,
			failed_count: 1,
			blocked_count: 2,
			waiting_count: 0,
		});
		expect(String(loop.outputs.summary).split("\n")).toEqual([
			`#1 failed: ${reason}`,
			"#2 blocked by #1",
			"#4 blocked by #2",
			"#3 done",
		]);
		expect(steps.find((s) => s.nodeId === "after")?.outputs.log_tail).toContain(
			"#3 done",
		);
		// Item 3 builds on the start: no item before it was done.
		expect(loop.items[3]?.baseBranch).toBe(RUN_BRANCH);
		expect(payloads(logged, "ItemEnded")[0]).toEqual({
			itemId: "1",
			state: "failed",
			reason,
			outputs: {},
		});
		expect(payloads(logged, "ItemBlocked")).toEqual([
			{
				item: {
					id: "2",
					title: "waits on 1",
					url: null,
					value: { id: "2", title: "waits on 1", blockedBy: ["1"] },
				},
				blocker: "1",
				reason: "blocked by #1",
			},
			{
				item: {
					id: "4",
					title: "waits on 2",
					url: null,
					value: { id: "4", title: "waits on 2", blockedBy: ["2"] },
				},
				blocker: "2",
				reason: "blocked by #2",
			},
		]);
		expect(await itemTypes(h)).toEqual([
			"ItemsRead",
			"ItemStarted",
			"ItemEnded",
			"ItemsRead",
			"ItemBlocked",
			"ItemBlocked",
			"ItemStarted",
			"ItemEnded",
			"ItemsRead",
		]);
		const transcript = await readTranscriptFile(loop.transcriptPath);
		expect(transcript.map((e) => e.event.type)).toEqual([
			"items-read",
			"item-start",
			"item-end",
			"items-read",
			"item-end",
			"item-end",
			"item-start",
			"item-end",
			"items-read",
		]);
		expect(transcript[4]?.event).toEqual({
			type: "item-end",
			itemId: "2",
			state: "blocked",
			reason: "blocked by #1",
		});
	});

	test("a body that ends on a haltOn label halts the loop", async () => {
		const build = body([
			agent("ask", "Go on with {{item.title}}?", {
				outcomes: [{ name: "go" }, { name: "halt" }],
			}),
		]);
		const harness = fakeHarness((_input: AgentSessionInput, call: number) =>
			reportingScript(call === 0 ? "go" : "halt"),
		);
		const h = await startRun(
			sandbox,
			flowOf([
				callEach(
					"loop",
					"build",
					json([
						{ id: "1", title: "one" },
						{ id: "2", title: "two" },
						{ id: "3", title: "three" },
					]),
					{ branch: "shared" },
				),
			]),
			{ harness, flows: { build } },
		);
		const { state, parked } = await drive(h, { inputs: {} });
		expect(parked).toEqual([]);
		expect(state.ended).toEqual({
			status: "finished",
			nodeId: "loop",
			outcome: "halted",
			reason: 'Ended at node "loop" with "halted".',
		});
		const loop = loopStep(deriveSteps(await h.events()));
		expect(loop.outcome).toBe("halted");
		expect(loop.items.map((i) => [i.facts.id, i.state])).toEqual([
			["1", "done"],
			["2", "halted"],
		]);
		expect(loop.items[1]?.reason).toBe(`Ended at node "ask" with "halt".`);
		expect(loop.outputs.waiting_count).toBe(1);
		expect(harness.calls[1]?.prompt).toBe("Go on with two?");
		expect(payloads(await h.events(), "ItemEnded")[1]).toEqual({
			itemId: "2",
			state: "halted",
			reason: `Ended at node "ask" with "halt".`,
			outputs: {},
		});
	});

	test("maxItems caps the elements one visit starts", async () => {
		const build = body([agent("worker", "Build {{item.title}}")]);
		const harness = fakeHarness();
		const h = await startRun(
			sandbox,
			flowOf([
				callEach(
					"loop",
					"build",
					json([
						{ id: "1", title: "a" },
						{ id: "2", title: "b" },
						{ id: "3", title: "c" },
					]),
					{ branch: "shared", maxItems: 2 },
				),
			]),
			{ harness, flows: { build } },
		);
		await drive(h, { inputs: {} });
		expect(harness.calls).toHaveLength(2);
		expect(loopStep(deriveSteps(await h.events())).outputs).toMatchObject({
			outcome: "done",
			done_count: 2,
			waiting_count: 1,
		});
	});

	test("a planner's data feeds the loop: `as`, bindings, the element's run fields and `results`", async () => {
		const task = flowOf(
			[agent("work", "Do {{task.title}} ({{task.id}}) for {{goal}}")],
			[],
			{
				inputs: [
					{ name: "task", type: "json", required: true },
					{ name: "goal", type: "text" },
				],
				outputs: [
					{ name: "result", value: "{{work.data}}" },
					{
						name: "label",
						value: "{{task.title}} at {{run.index}} on {{run.branch}}",
					},
				],
			},
		);
		const harness = fakeHarness((input: AgentSessionInput, call: number) =>
			call === 0
				? reportingScript("pass", "the plan", {
						tasks: [
							{ id: "t1", title: "One" },
							{ id: "t2", title: "Two", dependsOn: ["t1"] },
						],
					})
				: reportingScript("pass", "did it", { did: input.prompt }),
		);
		const h = await startRun(
			sandbox,
			flowOf(
				[
					agent("planner", "Plan", {
						output: {
							type: "object",
							required: ["tasks"],
							properties: { tasks: { type: "array" } },
						},
					}),
					callEach(
						"each",
						"task",
						{ kind: "json", value: "{{planner.data.tasks}}" },
						{
							as: "task",
							inputs: { goal: "{{planner.summary}}" },
							branch: "shared",
						},
					),
					command("report", `echo "{{each.results.1.outputs.label}}"`),
				],
				[
					edge("e1", "planner", "pass", "each"),
					edge("e2", "each", "done", "report"),
				],
			),
			{ harness, flows: { task } },
		);
		const { state } = await drive(h, { inputs: {} });
		expect(state.ended?.nodeId).toBe("report");
		expect(harness.calls.map((c) => c.prompt)).toEqual([
			"Plan",
			"Do One (t1) for the plan",
			"Do Two (t2) for the plan",
		]);
		const logged = await h.events();
		const steps = deriveSteps(logged);
		const each = loopStep(steps, "each");
		expect(
			each.items.map((i) => [
				i.facts.id,
				i.facts.title,
				i.state,
				i.facts.value,
			]),
		).toEqual([
			["t1", "One", "done", { id: "t1", title: "One" }],
			["t2", "Two", "done", { id: "t2", title: "Two", dependsOn: ["t1"] }],
		]);
		expect(payloads(logged, "ItemStarted")[0]?.inputs).toEqual({
			task: { id: "t1", title: "One" },
			goal: "the plan",
		});
		expect(each.outputs.results).toEqual([
			{
				id: "t1",
				title: "One",
				state: "done",
				reason: null,
				outputs: {
					result: { did: "Do One (t1) for the plan" },
					label: `One at 0 on ${RUN_BRANCH}`,
				},
			},
			{
				id: "t2",
				title: "Two",
				state: "done",
				reason: null,
				outputs: {
					result: { did: "Do Two (t2) for the plan" },
					label: `Two at 1 on ${RUN_BRANCH}`,
				},
			},
		]);
		expect(steps.find((s) => s.nodeId === "report")?.outputs.log_tail).toBe(
			`Two at 1 on ${RUN_BRANCH}`,
		);
	});

	test("the sources: a command (with its log, read again before each element), files, no JSON, a cycle", async () => {
		const itemsFile = join(sandbox.root, "items.json");
		await writeFile(itemsFile, JSON.stringify([{ id: "1", title: "a" }]));
		const build = body([agent("worker", "Build {{item.title}}")]);
		const harness = fakeHarness((_input: AgentSessionInput, call: number) => {
			if (call === 0) {
				writeFileSync(
					itemsFile,
					JSON.stringify([
						{ id: "1", title: "a", done: true },
						{ id: "2", title: "added" },
					]),
				);
			}
			return {};
		});
		const h = await startRun(
			sandbox,
			flowOf([
				callEach(
					"loop",
					"build",
					{ kind: "command", command: `cat '${itemsFile}'` },
					{ branch: "shared" },
				),
			]),
			{ harness, flows: { build } },
		);
		const { state } = await drive(h, { inputs: {} });
		expect(state.ended?.outcome).toBe("done");
		expect(harness.calls.map((c) => c.prompt)).toEqual([
			"Build a",
			"Build added",
		]);
		const loop = loopStep(deriveSteps(await h.events()));
		expect(loop.items.map((i) => i.facts.id)).toEqual(["1", "2"]);
		expect(loop.logPath).toBe(
			join(sandbox.dataDir, "logs", h.runId, `${loop.id}.log`),
		);
		expect(existsSync(loop.logPath as string)).toBe(true);
		expect(payloads(await h.events(), "ItemsRead")).toEqual([
			{ count: 1, open: 1 },
			{ count: 2, open: 1 },
			{ count: 2, open: 0 },
		]);

		const files = await startRun(
			sandbox,
			flowOf([
				callEach(
					"loop",
					"build",
					{ kind: "files", glob: "*.md" },
					{
						branch: "shared",
					},
				),
			]),
			{ harness, flows: { build } },
		);
		await drive(files, { inputs: {} });
		expect(payloads(await files.events(), "ItemStarted")).toEqual([
			{
				item: {
					id: "README.md",
					title: "README.md",
					url: null,
					value: { id: "README.md", title: "README.md", path: "README.md" },
				},
				index: 1,
				branch: null,
				baseBranch: null,
				inputs: {
					item: { id: "README.md", title: "README.md", path: "README.md" },
				},
			},
		]);

		const bad = await startRun(
			sandbox,
			flowOf([
				callEach("loop", "build", {
					kind: "command",
					command: "echo not json",
				}),
			]),
			{ harness, flows: { build } },
		);
		const noJson = await drive(bad, { inputs: {} });
		expect((noJson.parked[0] as { reason: string }).reason).toContain(
			"did not print JSON",
		);

		const cyclic = await startRun(
			sandbox,
			flowOf([
				callEach(
					"loop",
					"build",
					json([
						{ id: "1", title: "a", blockedBy: ["2"] },
						{ id: "2", title: "b", blockedBy: ["1"] },
					]),
				),
			]),
			{ harness, flows: { build } },
		);
		const cycle = await drive(cyclic, { inputs: {} });
		expect((cycle.parked[0] as { reason: string }).reason).toContain(
			"make a cycle",
		);
	});

	test("a dirty worktree fails the element instead of committing for it", async () => {
		const build = body([command("scribble", "echo x > loose.txt")]);
		const h = await startRun(
			sandbox,
			flowOf([
				callEach(
					"loop",
					"build",
					json([
						{ id: "1", title: "a" },
						{ id: "2", title: "b" },
					]),
				),
			]),
			{ harness: fakeHarness(), flows: { build } },
		);
		const { state } = await drive(h, { inputs: {} });
		expect(state.ended?.outcome).toBe("done");
		const loop = loopStep(deriveSteps(await h.events()));
		expect(loop.items.map((i) => [i.facts.id, i.state])).toEqual([
			["1", "done"],
			["2", "failed"],
		]);
		expect(loop.items[1]?.reason).toContain("loose.txt");
		expect(loop.items[1]?.reason).toContain("does not commit for you");
		expect(loop.items[1]?.branch).toBeNull();
		expect(payloads(await h.events(), "ItemEnded")[1]).toMatchObject({
			itemId: "2",
			state: "failed",
			outputs: {},
		});
	});

	test("a wait inside element 2 parks the run; a wake on a new compile over the same saver continues the element, then element 3 runs", async () => {
		const resetAt = Date.now() + 60_000;
		const harness = fakeHarness((_input: AgentSessionInput, call: number) =>
			call === 1 ? usageLimitScript(resetAt) : reportingScript("pass"),
		);
		const build = body([agent("worker", "Build {{item.title}}")]);
		const h = await startRun(
			sandbox,
			flowOf([
				callEach(
					"loop",
					"build",
					json([
						{ id: "1", title: "a" },
						{ id: "2", title: "b" },
						{ id: "3", title: "c" },
					]),
					{ branch: "shared" },
				),
			]),
			{ harness, flows: { build } },
		);
		const first = await drive(h, { inputs: {} });
		const steps = deriveSteps(await h.events());
		const loop = loopStep(steps);
		const waiting = steps.find(
			(s) => s.nodeId === "worker" && s.scope?.itemId === "2",
		);
		expect(first.parked).toEqual([
			{
				kind: "wait",
				stepId: waiting?.id as string,
				nodeId: "worker",
				reason: "usage-limit",
				until: resetAt + 1_000,
				message:
					"Usage limit: You've hit your limit. The step continues a minute after the reset.",
			},
		]);
		expect(first.next).toEqual(["loop"]);
		// The loop committed element 1: the cursor, and only the cursor, is in
		// the state (the list and the results are in the log).
		expect(first.state.loops.loop).toEqual({ index: 1 });
		expect(first.state.visits).toEqual({ loop: 1 });
		expect(first.state.pending).toBeNull();
		// The For Each step and element 2 are open.
		expect(loop.endedAt).toBeNull();
		expect(loop.items.map((i) => [i.facts.id, i.state, i.open])).toEqual([
			["1", "done", false],
			["2", "running", true],
		]);
		expect(payloads(await h.events(), "WaitStarted")).toHaveLength(1);

		await h.log.append({
			type: "WaitEnded",
			runId: h.runId,
			stepId: waiting?.id as string,
			payload: { early: false },
		});
		const second = await drive(
			h,
			new Command({ resume: { kind: "wake", early: false } }),
			h.graph(),
		);
		expect(second.parked).toEqual([]);
		expect(second.state.ended?.outcome).toBe("done");
		expect(harness.calls).toHaveLength(4);
		expect(
			harness.calls.map((c) => [c.prompt, c.resumeSessionId ?? null]),
		).toEqual([
			["Build a", null],
			["Build b", null],
			[DEFAULT_RESUME_PROMPT, "fake-session-2"],
			["Build c", null],
		]);
		const logged = await h.events();
		const after = loopStep(deriveSteps(logged));
		expect(after.id).toBe(loop.id);
		expect(after.items.map((i) => [i.facts.id, i.state])).toEqual([
			["1", "done"],
			["2", "done"],
			["3", "done"],
		]);
		expect(after.outputs).toMatchObject({ outcome: "done", done_count: 3 });
		expect(await itemTypes(h)).toEqual([
			"ItemsRead",
			"ItemStarted",
			"ItemEnded",
			"ItemsRead",
			"ItemStarted",
			"ItemEnded",
			"ItemsRead",
			"ItemStarted",
			"ItemEnded",
			"ItemsRead",
		]);
		// The loop step was never reopened (it stayed open), nor started twice.
		expect(
			deriveSteps(logged).filter((s) => s.nodeType === "call"),
		).toHaveLength(1);
		expect(logged.filter((e) => e.type === "StepReopened")).toHaveLength(0);
		expect(
			deriveSteps(logged).find((s) => s.id === waiting?.id)?.sessions,
		).toHaveLength(2);
	});

	test("a stop inside an element ends the step stopped and parks the run; a resume reopens it and continues the same element, then the loop", async () => {
		const controller = new AbortController();
		const harness = fakeHarness((_input: AgentSessionInput, call: number) => {
			if (call !== 0) return reportingScript("pass");
			// The person stops the run while element 1's session runs.
			setTimeout(() => controller.abort(), 50);
			return { steps: [{ type: "wait", ms: 10_000 }] };
		});
		const build = body(
			[agent("worker", "Build {{item.title}}"), command("commit", commitItem)],
			[edge("b1", "worker", "pass", "commit")],
		);
		const h = await startRun(
			sandbox,
			flowOf([
				callEach(
					"loop",
					"build",
					json([
						{ id: "1", title: "a" },
						{ id: "2", title: "b" },
					]),
				),
			]),
			{ harness, flows: { build }, signal: controller.signal },
		);
		const first = await drive(h, { inputs: {} });
		const stoppedSteps = deriveSteps(await h.events());
		const loopStopped = loopStep(stoppedSteps);
		const worker = stoppedSteps.find((s) => s.nodeId === "worker");
		expect(first.parked).toEqual([
			{
				kind: "parked",
				stepId: worker?.id as string,
				nodeId: "worker",
				status: "stopped",
				reason: null,
			},
		]);
		expect(first.next).toEqual(["loop"]);
		expect(loopStopped.outcome).toBe("stopped");
		expect(loopStopped.outputs).toMatchObject({
			outcome: "stopped",
			summary: "#1 running\n#2 not started",
		});
		// The item no longer runs: it shows failed with why, until a resume.
		expect(
			loopStopped.items.map((i) => [i.facts.id, i.state, i.reason, i.endedAt]),
		).toEqual([
			["1", "failed", "The run stopped during this item.", loopStopped.endedAt],
		]);
		expect(await h.types()).toEqual([
			"RunStarted",
			"StepStarted",
			"ItemsRead",
			"ItemStarted",
			"StepStarted",
			"SessionStarted",
			"HarnessSessionAssigned",
			"SessionEnded",
			"StepEnded",
			"StepEnded",
		]);

		const again = new AbortController();
		h.ctx.signal = () => again.signal;
		await h.log.append({
			type: "RunResumed",
			runId: h.runId,
			payload: {
				nodeId: "worker",
				stepId: worker?.id ?? null,
				prompt: null,
				scope: { parentStepId: loopStopped.id, itemId: "1" },
				by: "person",
			},
		});
		const second = await drive(h, new Command({ resume: { kind: "resume" } }));
		expect(second.parked).toEqual([]);
		expect(second.state.ended?.outcome).toBe("done");
		expect(
			harness.calls.map((c) => [c.prompt, c.resumeSessionId ?? null]),
		).toEqual([
			["Build a", null],
			[DEFAULT_RESUME_PROMPT, "fake-session-1"],
			["Build b", null],
		]);
		expect((await h.types()).slice(10)).toEqual([
			"RunResumed",
			"StepReopened",
			"StepReopened",
			"SessionStarted",
			"HarnessSessionAssigned",
			"SessionEnded",
			"StepEnded",
			"EdgeTaken",
			"StepStarted",
			"StepEnded",
			"ItemEnded",
			"ItemsRead",
			"ItemStarted",
			"StepStarted",
			"SessionStarted",
			"HarnessSessionAssigned",
			"SessionEnded",
			"StepEnded",
			"EdgeTaken",
			"StepStarted",
			"StepEnded",
			"ItemEnded",
			"ItemsRead",
			"StepEnded",
		]);
		const logged = await h.events();
		expect(
			logged
				.filter((e) => e.type === "StepReopened")
				.map((e) => [e.stepId, e.payload]),
		).toEqual([
			[loopStopped.id, { prompt: null }],
			[worker?.id as string, { prompt: DEFAULT_RESUME_PROMPT }],
		]);
		const loop = loopStep(deriveSteps(logged));
		expect(loop.id).toBe(loopStopped.id);
		expect(loop.outcome).toBe("done");
		expect(loop.items.map((i) => [i.facts.id, i.state])).toEqual([
			["1", "done"],
			["2", "done"],
		]);
		const workers = deriveSteps(logged).filter((s) => s.nodeId === "worker");
		expect(workers.map((s) => s.sessions.length)).toEqual([2, 1]);
		expect(loop.items[1]?.baseBranch).toBe(loop.items[0]?.branch ?? "");
		expect(payloads(logged, "ItemStarted")).toHaveLength(2);
	});

	test("a failure that parks before a body step (the step cap) ends the step error and parks the run; a resume reopens it and continues inside the element", async () => {
		const harness = fakeHarness(reportingScript("pass"));
		const build = body([agent("worker", "Build {{item.title}}")]);
		const h = await startRun(
			sandbox,
			flowOf([
				callEach(
					"loop",
					"build",
					json([
						{ id: "1", title: "a" },
						{ id: "2", title: "b" },
						{ id: "3", title: "c" },
					]),
					{ branch: "shared" },
				),
			]),
			{ harness, flows: { build } },
		);
		h.ctx.settings = () => ({ ...defaultRunSettings(), maxStepsPerRun: 3 });
		const first = await drive(h, { inputs: {} });
		const loop = loopStep(deriveSteps(await h.events()));
		const reason =
			'The run reached the limit of 3 steps before node "worker". Resume it to continue.';
		expect(first.parked).toEqual([
			{
				kind: "parked",
				stepId: null,
				nodeId: "worker",
				status: "failed",
				reason,
			},
		]);
		expect(first.next).toEqual(["loop"]);
		expect(loop.outcome).toBe("error");
		expect(loop.error).toBe(reason);
		expect(loop.items.map((i) => [i.facts.id, i.state, i.open])).toEqual([
			["1", "done", false],
			["2", "done", false],
			["3", "failed", true],
		]);
		expect(harness.calls).toHaveLength(2);

		await h.log.append({
			type: "RunResumed",
			runId: h.runId,
			payload: {
				nodeId: "worker",
				stepId: null,
				prompt: null,
				scope: { parentStepId: loop.id, itemId: "3" },
				by: "person",
			},
		});
		const second = await drive(h, new Command({ resume: { kind: "resume" } }));
		expect(second.parked).toEqual([]);
		expect(second.state.ended?.outcome).toBe("done");
		expect(harness.calls.map((c) => c.prompt)).toEqual([
			"Build a",
			"Build b",
			"Build c",
		]);
		const logged = await h.events();
		const after = loopStep(deriveSteps(logged));
		expect(after.id).toBe(loop.id);
		expect(after.items.map((i) => [i.facts.id, i.state])).toEqual([
			["1", "done"],
			["2", "done"],
			["3", "done"],
		]);
		expect(payloads(logged, "ItemStarted")).toHaveLength(3);
		expect(
			logged.filter((e) => e.type === "StepReopened").map((e) => e.stepId),
		).toEqual([loop.id]);
	});

	test("a stop after the running step parks between elements; a resume reopens the step and goes on with the next element", async () => {
		const build = body([agent("worker", "Build {{item.title}}")]);
		let h: Harness;
		const harness = fakeHarness((_input: AgentSessionInput, call: number) => {
			if (call === 0) {
				void h.log.append({
					type: "StopAfterStepRequested",
					runId: h.runId,
					payload: {},
				});
			}
			return reportingScript("pass");
		});
		h = await startRun(
			sandbox,
			flowOf([
				callEach(
					"loop",
					"build",
					json([
						{ id: "1", title: "a" },
						{ id: "2", title: "b" },
					]),
					{ branch: "shared" },
				),
			]),
			{ harness, flows: { build } },
		);
		const first = await drive(h, { inputs: {} });
		const loop = loopStep(deriveSteps(await h.events()));
		expect(first.parked).toEqual([
			{
				kind: "parked",
				stepId: loop.id,
				nodeId: "loop",
				status: "stopped",
				reason: "Stopped after the running step, as asked.",
			},
		]);
		expect(first.next).toEqual(["park__loop"]);
		expect(first.state.loops).toEqual({ loop: null });
		expect(first.state.pending).toMatchObject({
			kind: "parked",
			stepId: loop.id,
			nodeId: "loop",
			status: "stopped",
		});
		expect(loop.outcome).toBe("stopped");
		expect(loop.items.map((i) => [i.facts.id, i.state])).toEqual([
			["1", "done"],
		]);

		await h.log.append({
			type: "RunResumed",
			runId: h.runId,
			payload: { nodeId: "loop", stepId: loop.id, prompt: null, by: "person" },
		});
		const second = await drive(h, new Command({ resume: { kind: "resume" } }));
		expect(second.state.ended?.outcome).toBe("done");
		const logged = await h.events();
		const after = loopStep(deriveSteps(logged));
		expect(after.id).toBe(loop.id);
		expect(after.items.map((i) => [i.facts.id, i.state])).toEqual([
			["1", "done"],
			["2", "done"],
		]);
		expect(
			logged.filter((e) => e.type === "StepReopened").map((e) => e.stepId),
		).toEqual([loop.id]);
		expect(second.state.visits).toEqual({ loop: 1 });
	});

	test("after a daemon death inside an element, the node re-runs, continues the element and the body resumes at its own last checkpoint", async () => {
		const harness = fakeHarness(reportingScript("pass"));
		const build = body(
			[
				agent("first", "First {{item.id}}"),
				agent("second", "Second {{item.id}}"),
			],
			[edge("b1", "first", "pass", "second")],
		);
		const h = await startRun(
			sandbox,
			flowOf([
				callEach(
					"loop",
					"build",
					json([
						{ id: "1", title: "a" },
						{ id: "2", title: "b" },
						{ id: "3", title: "c" },
					]),
					{ branch: "shared" },
				),
			]),
			{ harness, flows: { build } },
		);
		// The daemon dies while element 2's second step starts (after its
		// StepStarted, before its session).
		const recorder = h.ctx.recorder;
		let crashes = 1;
		h.ctx.recorder = async (stepId, path) => {
			const own = deriveSteps(await h.events()).find((s) => s.id === stepId);
			if (
				own?.nodeId === "second" &&
				own.scope?.itemId === "2" &&
				crashes-- > 0
			) {
				throw new Error("the daemon died");
			}
			return recorder(stepId, path);
		};
		await expect(drive(h, { inputs: {} })).rejects.toThrow("the daemon died");
		expect(harness.calls.map((c) => c.prompt)).toEqual([
			"First 1",
			"Second 1",
			"First 2",
		]);
		const crashed = deriveSteps(await h.events());
		const loop = loopStep(crashed);
		const dead = crashed.find(
			(s) => s.nodeId === "second" && s.scope?.itemId === "2",
		);
		expect(dead?.endedAt).toBeNull();
		expect(loop.endedAt).toBeNull();
		// The root's checkpoint is after element 1: the task for element 2 never committed.
		const snapshot = await h.graph().getState(h.config);
		expect(snapshot.next).toEqual(["loop"]);
		expect(
			(snapshot.values as { loops: Record<string, unknown> }).loops.loop,
		).toMatchObject({
			index: 1,
		});

		// Recovery closes the open steps as interrupted; the engine appends
		// RunResumed and re-runs the thread with invoke(null).
		const interrupted = (stepId: string) =>
			h.log.append({
				type: "StepEnded",
				runId: h.runId,
				stepId,
				payload: {
					outcome: "interrupted",
					outputs: { outcome: "interrupted", visit: 1 },
					error: "Night Shift stopped while this ran.",
				},
			});
		await interrupted(dead?.id as string);
		await interrupted(loop.id);
		await h.log.append({
			type: "RunResumed",
			runId: h.runId,
			payload: {
				nodeId: "second",
				stepId: dead?.id ?? null,
				prompt: null,
				scope: { parentStepId: loop.id, itemId: "2" },
				by: "daemon",
				reason: "Night Shift restarted.",
			},
		});
		const { parked, state } = await drive(h, null);
		expect(parked).toEqual([]);
		expect(state.ended?.outcome).toBe("done");
		// "First 2" did not run again: element 2's body went on from its checkpoint.
		expect(harness.calls.map((c) => c.prompt)).toEqual([
			"First 1",
			"Second 1",
			"First 2",
			"Second 2",
			"First 3",
			"Second 3",
		]);
		const logged = await h.events();
		const after = loopStep(deriveSteps(logged));
		expect(after.id).toBe(loop.id);
		expect(after.items.map((i) => [i.facts.id, i.state])).toEqual([
			["1", "done"],
			["2", "done"],
			["3", "done"],
		]);
		expect(payloads(logged, "ItemStarted")).toHaveLength(3);
		expect(
			logged.filter((e) => e.type === "StepReopened").map((e) => e.stepId),
		).toEqual([loop.id]);
		expect(
			deriveSteps(logged)
				.filter((s) => s.nodeId === "second" && s.scope?.itemId === "2")
				.map((s) => [s.visit, s.outcome]),
		).toEqual([
			[1, "interrupted"],
			[2, "pass"],
		]);
	});
});
