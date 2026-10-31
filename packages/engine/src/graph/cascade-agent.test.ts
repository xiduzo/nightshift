import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Command } from "@langchain/langgraph";
import { fakeHarness, reportingScript } from "@nightshift/agents/testing";
import type { AgentNode, CallNode, Flow } from "@nightshift/flows";
import { foldRun } from "../log";
import { deriveSteps } from "../read/run-views";
import {
	agent,
	command,
	drive,
	flowOf,
	held,
	startRun,
} from "../testing/graph";
import { createSandbox, type Sandbox } from "../testing/test-support";

/**
 * An Agent and a Call that climb a cascade (ADR 6), on the compiled graph
 * with a fake harness, a real run log and checkpoint saver.
 */

const at = { x: 0, y: 0 };

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(async () => {
	await sandbox.cleanup();
});

/** Sonnet twice, resuming its session, then Opus; the check holds only on Opus. */
function worker(extra: Partial<AgentNode> = {}): AgentNode {
	const {
		harness: _h,
		model: _m,
		...plain
	} = agent("worker", "Make the tests pass.");
	return {
		...plain,
		cascade: [
			{
				label: "sonnet",
				model: "sonnet",
				harness: "claude-code",
				tries: 2,
				session: "resume",
			},
			{ label: "rescue", model: "opus", harness: "claude-code" },
		],
		check:
			'echo "checked on {{cascade.tier}}"; test "{{cascade.tier}}" = rescue',
		...extra,
	};
}

const around = (node: AgentNode | CallNode): Flow =>
	flowOf({
		start: node.id,
		nodes: [node, command("after", "true")],
		edges: [{ id: "e1", from: node.id, outcome: "pass", to: "after" }],
	});

describe("an Agent climbs its cascade", () => {
	test("a check that fails sends the next try the failure; the next tier starts fresh and holds", async () => {
		const harness = fakeHarness(reportingScript("pass", "Tests fixed."));
		const h = await startRun(sandbox, around(worker()), { harness });
		const { parked, state } = await drive(h, { inputs: {} });
		expect(parked).toEqual([]);
		expect(state.ended?.nodeId).toBe("after");
		expect(harness.calls.map((c) => c.model)).toEqual([
			"sonnet",
			"sonnet",
			"opus",
		]);
		const [first, second, third] = harness.calls;
		expect(first?.prompt).toBe("Make the tests pass.");
		expect(first?.resumeSessionId).toBeUndefined();
		// Within the tier the session goes on, told what failed.
		expect(second?.resumeSessionId).toBe("fake-session-1");
		expect(second?.prompt).toContain(
			"The try before this one (tier sonnet, try 1) did not finish the task. It ended fail.",
		);
		expect(second?.prompt).toContain("checked on sonnet");
		expect(second?.prompt).not.toContain("Make the tests pass.");
		// A new tier starts a new session, with the task and the failure.
		expect(third?.resumeSessionId).toBeUndefined();
		expect(third?.prompt).toStartWith(
			"Make the tests pass.\n\nThe try before this one (tier sonnet, try 2)",
		);
		const steps = deriveSteps(foldRun(await h.events())).filter(
			(step) => step.nodeId === "worker",
		);
		expect(steps.map((step) => [step.visit, step.outcome])).toEqual([
			[1, "fail"],
			[2, "fail"],
			[3, "pass"],
		]);
		expect(steps[0]?.error).toContain("exited with code 1");
		expect(steps[0]?.logPath).not.toBeNull();
		expect(state.nodes.worker).toMatchObject({
			outcome: "pass",
			summary: "Tests fixed.",
			tier: "rescue",
			tries: 3,
			log_tail: "checked on rescue",
		});
		expect(state.cascades?.worker).toBeNull();
	});

	test("an agent that reports fail climbs without a check run", async () => {
		const harness = fakeHarness((_input, call) =>
			reportingScript(call === 0 ? "fail" : "pass"),
		);
		const h = await startRun(sandbox, around(worker({ check: undefined })), {
			harness,
		});
		const { state } = await drive(h, { inputs: {} });
		expect(state.ended?.nodeId).toBe("after");
		expect(harness.calls).toHaveLength(2);
		expect(state.nodes.worker?.log_tail).toBeUndefined();
	});

	test("the person tier asks try again or stop; try again runs the last tier once more with the note", async () => {
		const harness = fakeHarness((_input, call) =>
			reportingScript(call < 2 ? "fail" : "pass", `Try ${call + 1}.`),
		);
		const node = worker({
			check: undefined,
			cascade: [
				{ label: "cheap", model: "sonnet", harness: "claude-code" },
				{ label: "strong", model: "opus", harness: "claude-code" },
				{ person: true },
			],
		});
		const h = await startRun(sandbox, around(node), { harness });
		const first = await drive(h, { inputs: {} });
		expect(first.parked).toEqual([
			{
				kind: "gate",
				stepId: expect.any(String),
				nodeId: "worker",
				question:
					"No tier finished this step. What each try did:\n- cheap ended fail: Try 1.\n- strong ended fail: Try 2.",
				choices: [
					expect.objectContaining({ name: "try-again" }),
					expect.objectContaining({ name: "stop" }),
				],
			},
		]);
		expect(held(first.state)).toMatchObject({ kind: "gate", climb: true });
		const second = await drive(
			h,
			new Command({
				resume: { kind: "gate", choice: "try-again", note: "Use the v2 API." },
			}),
			h.graph(),
		);
		expect(second.parked).toEqual([]);
		expect(second.state.ended?.nodeId).toBe("after");
		expect(harness.calls.map((c) => c.model)).toEqual([
			"sonnet",
			"opus",
			"opus",
		]);
		expect(harness.calls[2]?.prompt).toContain(
			"A person adds: Use the v2 API.",
		);
		const steps = deriveSteps(foldRun(await h.events())).filter(
			(step) => step.nodeId === "worker",
		);
		expect(steps.map((step) => step.outcome)).toEqual([
			"fail",
			"fail",
			"try-again",
			"pass",
		]);
		expect(second.state.nodes.worker).toMatchObject({
			tier: "strong",
			tries: 3,
		});
	});

	test("stop at the person tier ends the step fail", async () => {
		const harness = fakeHarness(reportingScript("fail", "Stuck."));
		const node = worker({
			check: undefined,
			cascade: [{ model: "sonnet", harness: "claude-code" }, { person: true }],
		});
		const h = await startRun(
			sandbox,
			flowOf({
				start: "worker",
				nodes: [node, command("after", "true"), command("report", "true")],
				edges: [
					{ id: "e1", from: "worker", outcome: "pass", to: "after" },
					{ id: "e2", from: "worker", outcome: "fail", to: "report" },
				],
			}),
			{ harness },
		);
		await drive(h, { inputs: {} });
		const second = await drive(
			h,
			new Command({ resume: { kind: "gate", choice: "stop" } }),
			h.graph(),
		);
		expect(second.state.ended?.nodeId).toBe("report");
		expect(second.state.nodes.worker).toMatchObject({
			outcome: "fail",
			summary: "Stuck.",
			tier: "person",
			tries: 2,
		});
		expect(second.state.cascades?.worker).toBeNull();
	});
});

describe("a Call climbs its cascade", () => {
	const body = (script: string): Flow =>
		flowOf({
			inputs: [{ name: "issue" }, { name: "before" }],
			start: "work",
			nodes: [command("work", script)],
			edges: [],
		});

	test("a flow that fails goes to the next tier's flow, whose inputs read the try before", async () => {
		const node: CallNode = {
			id: "fix",
			type: "call",
			position: at,
			flow: "quick",
			inputs: { issue: "42" },
			cascade: [
				{},
				{
					flow: "deep",
					inputs: { issue: "42", before: "{{cascade.previous.outcome}}" },
				},
			],
		};
		const h = await startRun(sandbox, around(node), {
			flows: {
				quick: body("exit 1"),
				deep: body('test "{{before}}" = fail'),
			},
		});
		const { parked, state } = await drive(h, { inputs: {} });
		expect(parked).toEqual([]);
		expect(state.ended?.nodeId).toBe("after");
		const steps = deriveSteps(foldRun(await h.events())).filter(
			(step) => step.nodeId === "fix",
		);
		expect(steps.map((step) => [step.call?.flow, step.outcome])).toEqual([
			["quick", "fail"],
			["deep", "pass"],
		]);
		expect(steps[1]?.call?.inputs).toEqual({ issue: "42", before: "fail" });
		expect(state.nodes.fix).toMatchObject({
			outcome: "pass",
			tier: "2",
			tries: 2,
		});
	});
});
