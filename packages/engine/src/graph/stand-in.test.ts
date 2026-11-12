import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { Command } from "@langchain/langgraph";
import { fakeHarness, reportingScript } from "@nightshift/agents/testing";
import type { DecisionNode, Flow, JoinNode } from "@nightshift/flows";
import { defaultRunSettings } from "../device-config/settings";
import {
	foldRun,
	type LoggedEvent,
	type StepOutputs,
	type TestRun,
} from "../log";
import { listMemory } from "../memory";
import { parseCalledFlows, parseRunFlow } from "../read";
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
import { createSandbox, type Sandbox } from "../testing/test-support";
import { keptValues } from "../variables";
import { OUTRUN_ERROR } from "./branches";
import { closeOpenWork } from "./open-work";

/**
 * The stand-ins of a test run (ADR 27, `stand-in.ts`) on the compiled
 * graph: a pinned node gives the output it was pinned to, a skipped node
 * its outcome with empty fields, and neither does its work. The route on
 * goes on as for any step, and a test run keeps nothing that lasts.
 */

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(async () => {
	await sandbox.cleanup();
});

const at = { x: 0, y: 0 };

/** What an earlier run's research step gave. */
const RESEARCH: StepOutputs = {
	outcome: "pass",
	output: "",
	summary: "Found 3 leads.",
	data: { leads: ["a", "b", "c"] },
	visit: 2,
};

/** A test run that pins `nodeId` to RESEARCH, from an earlier run's step. */
const pinned = (nodeId: string, outputs = RESEARCH): TestRun => ({
	pinned: {
		[nodeId]: {
			runId: "run-earlier",
			stepId: "step-earlier",
			endedAt: 1_000,
			outcome: "pass",
			outputs,
		},
	},
	skipped: {},
});

const gate = (id: string): DecisionNode => ({
	id,
	type: "decision",
	position: at,
	prompt: "Send it?",
	options: [{ name: "send" }, { name: "hold" }],
	by: "person",
});

/** Each step as the log has it: node, outcome, how it stood in. */
const steps = async (h: Harness) =>
	[...foldRun(await h.events()).steps.values()].map((s) => [
		s.nodeId,
		s.outcome,
		s.test ?? null,
	]);

describe("a pinned node", () => {
	test("an Agent gives the pinned output and opens no session, on no Device and no rung", async () => {
		// The Device has no harness: the Agent would fail if it ran.
		const h = await startRun(
			sandbox,
			flowOf(
				[
					agent("research", "Find leads"),
					command("report", 'echo "{{research.summary}}"'),
				],
				[edge("e1", "research", "pass", "report")],
			),
			{ test: pinned("research") },
		);
		const driven = await drive(h, { inputs: {} });

		expect(driven.outcome.kind).toBe("ended");
		const events = await h.events();
		expect(events.some((e) => e.type === "SessionStarted")).toBe(false);
		const [started] = payloads(events, "StepStarted");
		expect(started).toMatchObject({ nodeId: "research", test: "pinned" });
		expect(started).not.toHaveProperty("deviceId");
		expect(started).not.toHaveProperty("rung");
		expect(started?.logPath).toBeNull();
		const [research, report] = payloads(events, "StepEnded");
		// The output is the earlier step's, with this run's visit.
		expect(research).toEqual({
			outcome: "pass",
			outputs: { ...RESEARCH, visit: 1 },
			error: null,
		});
		expect(report?.outputs.log_tail).toBe("Found 3 leads.");
		const step = [...foldRun(events).steps.values()][0];
		expect(step?.pinnedFrom).toEqual({
			runId: "run-earlier",
			stepId: "step-earlier",
			endedAt: 1_000,
		});
		// A run without the pin runs the node for real.
		const real = await startRun(
			sandbox,
			flowOf([agent("research", "Find leads")]),
		);
		await drive(real, { inputs: {} });
		expect(await steps(real)).toEqual([["research", "error", null]]);
	});

	test("a pinned branch wins a Join that waits for the first, and the other branch stops", async () => {
		const join: JoinNode = {
			id: "joined",
			type: "join",
			position: at,
			wait: "first",
		};
		const h = await startRun(
			sandbox,
			flowOf(
				[
					command("start", "true"),
					command("slow", "sleep 5"),
					agent("research", "Find leads"),
					join,
					command("after", "true"),
				],
				[
					edge("e1", "start", "pass", "slow"),
					edge("e2", "start", "pass", "research"),
					edge("e3", "slow", "pass", "joined"),
					edge("e4", "research", "pass", "joined"),
					edge("e5", "joined", "done", "after"),
				],
			),
			{ test: pinned("research") },
		);
		const driven = await drive(h, { inputs: {} });

		expect(driven.outcome.kind).toBe("ended");
		expect(driven.state.ended).toMatchObject({ nodeId: "after" });
		const logged = [...foldRun(await h.events()).steps.values()];
		const slow = logged.find((s) => s.nodeId === "slow");
		expect([slow?.outcome, slow?.error]).toEqual(["stopped", OUTRUN_ERROR]);
		expect(logged.find((s) => s.nodeId === "research")?.test).toBe("pinned");
	});

	test("a pinned node in a loop gives its output on each visit until the step cap, and a resume keeps the pin", async () => {
		const h = await startRun(
			sandbox,
			flowOf(
				[agent("poll", "Look again"), command("finish", "true")],
				[
					{ ...edge("again", "poll", "pass", "poll"), max: 4 },
					edge("done", "poll", "pass", "finish"),
				],
			),
			{ test: pinned("poll") },
		);
		h.ctx.settings = () => ({ ...defaultRunSettings(), maxStepsPerRun: 3 });
		const first = await drive(h, { inputs: {} });
		expect(first.parked).toEqual([
			expect.objectContaining({
				status: "failed",
				reason:
					'The run reached the limit of 3 steps before node "poll". Resume it to continue.',
			}),
		]);
		expect(await steps(h)).toEqual([
			["poll", "pass", "pinned"],
			["poll", "pass", "pinned"],
			["poll", "pass", "pinned"],
		]);

		await h.log.append({
			type: "RunResumed",
			runId: h.runId,
			payload: { nodeId: "poll", stepId: null, prompt: null, by: "person" },
		});
		const second = await drive(h, new Command({ resume: { kind: "resume" } }));
		expect(second.state.ended).toMatchObject({ nodeId: "finish" });
		expect(await steps(h)).toEqual([
			["poll", "pass", "pinned"],
			["poll", "pass", "pinned"],
			["poll", "pass", "pinned"],
			["poll", "pass", "pinned"],
			["poll", "pass", "pinned"],
			["finish", "pass", null],
		]);
	});

	test("a daemon that dies before the stand-in ends leaves it interrupted, and the node stands in again", async () => {
		const quiet = spyOn(console, "error").mockImplementation(() => {});
		try {
			const h = await startRun(
				sandbox,
				flowOf(
					[agent("research", "Find leads"), command("after", "true")],
					[edge("e1", "research", "pass", "after")],
				),
				{ test: pinned("research") },
			);
			const { log } = h.ctx;
			let died = false;
			h.ctx.log = {
				...log,
				append: async (input, writes) => {
					if (input.type === "StepEnded" && !died) {
						died = true;
						throw new Error("the daemon died");
					}
					return log.append(input, writes);
				},
			};
			await expect(drive(h, { inputs: {} })).rejects.toThrow();
			h.ctx.log = log;
			await closeOpenWork(
				{
					log: h.log,
					bus: h.deps.shared.bus,
					flowOf: parseRunFlow,
					calledFlowsOf: parseCalledFlows,
				},
				h.runId,
				{ kind: "interrupted", reason: "Night Shift stopped while this ran." },
			);

			const again = await drive(h, null, h.graph());
			expect(again.state.ended).toMatchObject({ nodeId: "after" });
			expect(await steps(h)).toEqual([
				["research", "interrupted", "pinned"],
				["research", "pass", "pinned"],
				["after", "pass", null],
			]);
		} finally {
			quiet.mockRestore();
		}
	});
});

describe("a skipped node", () => {
	test("a skipped Gate asks nobody and routes on its outcome", async () => {
		const h = await startRun(
			sandbox,
			flowOf(
				[gate("approve"), command("send", "true"), command("hold", "true")],
				[
					edge("e1", "approve", "send", "send"),
					edge("e2", "approve", "hold", "hold"),
				],
			),
			{ test: { pinned: {}, skipped: { approve: "send" } } },
		);
		const driven = await drive(h, { inputs: {} });

		expect(driven.parked).toEqual([]);
		expect(driven.state.ended).toMatchObject({ nodeId: "send" });
		const events = await h.events();
		expect(events.some((e) => e.type === "GateOpened")).toBe(false);
		expect(await steps(h)).toEqual([
			["approve", "send", "skipped"],
			["send", "pass", null],
		]);
	});

	test("gives every output field null, and its writes still apply", async () => {
		const h = await startRun(
			sandbox,
			flowOf(
				[
					command("fetch", "exit 1", {
						set: [{ variable: "count", expression: "vars.count + 1" }],
					}),
					command("after", 'echo "{{vars.count}}"'),
				],
				[edge("e1", "fetch", "pass", "after")],
				{ variables: [{ name: "count", type: "number", initial: "0" }] },
			),
			{ test: { pinned: {}, skipped: { fetch: "pass" } } },
		);
		const driven = await drive(h, { inputs: {} });

		expect(driven.state.ended).toMatchObject({ nodeId: "after" });
		const [fetch, after] = payloads(await h.events(), "StepEnded");
		const { outcome, visit, ...fields } = fetch?.outputs ?? {};
		expect([outcome, visit]).toEqual(["pass", 1]);
		expect(Object.keys(fields)).toContain("log_tail");
		expect(Object.values(fields).every((value) => value === null)).toBe(true);
		expect(fetch?.variables).toEqual({ count: 1 });
		expect(after?.outputs.log_tail).toBe("1");
	});
});

describe("a test run", () => {
	const items = [{ id: "a" }, { id: "b" }];
	const DATA = {
		scores: { found: 3 },
		link: "https://github.com/example/site/pull/7",
	};

	/** A watch flow: what is new, the research, a note that keeps a variable and gives data. */
	const watch: Flow = flowOf(
		[
			{
				id: "fresh",
				type: "since-last-run",
				position: at,
				items: "{{items}}",
				key: "id",
			},
			agent("research", "Find leads"),
			command("note", `echo '{"count":2}'`, {
				stdout: "json",
				set: [{ variable: "last", value: "seen" }],
			}),
		],
		[
			edge("e1", "fresh", "new", "research"),
			edge("e2", "research", "pass", "note"),
		],
		{
			inputs: [{ name: "items", type: "json" }],
			variables: [{ name: "last", type: "text", keep: "project" }],
		},
	);
	const flowName = "watch";
	const kept = { spaceId: "", projectId: "project-1", flowName };

	/** One run of `watch`: its events and the shapes it gave to keep. */
	async function runWatch(
		options: { test?: TestRun; harness?: ReturnType<typeof fakeHarness> } = {},
	): Promise<{ events: LoggedEvent[]; shapes: string[] }> {
		const shapes: string[] = [];
		const h = await startRun(sandbox, watch, {
			flowName,
			inputs: { items },
			keepShapes: async (_flow, node) => {
				shapes.push(node.id);
			},
			...options,
		});
		const driven = await drive(h, { inputs: { items } });
		expect(driven.state.ended).toMatchObject({ nodeId: "note" });
		return { events: await h.events(), shapes };
	}

	test("keeps nothing that lasts: no kept values, memory, shapes, scores or pull request of a stand-in", async () => {
		const outputs = { ...RESEARCH, data: DATA };
		const tested = await runWatch({ test: pinned("research", outputs) });

		for (const ended of payloads(tested.events, "StepEnded")) {
			expect(ended).not.toHaveProperty("kept");
			expect(ended).not.toHaveProperty("memory");
			expect(ended).not.toHaveProperty("shapes");
		}
		expect(tested.shapes).toEqual([]);
		const types = tested.events.map((e) => e.type);
		expect(types).not.toContain("Scored");
		expect(types).not.toContain("PullRequestOpened");
		const space = { ...kept, spaceId: sandbox.spaceId };
		expect(await keptValues(sandbox.db, space)).toEqual({});
		expect(await listMemory(sandbox.db, space)).toEqual([]);
		// The run still read what it needs: every item was new to it.
		const [fresh] = payloads(tested.events, "StepEnded");
		expect(fresh?.outcome).toBe("new");

		// The same flow as a run that is not a test keeps all of it.
		const real = await runWatch({
			harness: fakeHarness({
				...reportingScript("pass", "Found 3 leads.", DATA),
				delayMs: 0,
			}),
		});
		const realTypes = real.events.map((e) => e.type);
		expect(realTypes).toContain("Scored");
		expect(realTypes).toContain("PullRequestOpened");
		expect(real.shapes).toEqual(["research", "note"]);
		expect(await keptValues(sandbox.db, space)).toEqual({ last: "seen" });
		expect((await listMemory(sandbox.db, space)).length).toBeGreaterThan(0);
	});
});
