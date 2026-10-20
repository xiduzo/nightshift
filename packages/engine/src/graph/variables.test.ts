import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { FlowEdge } from "@nightshift/flows";

import { deriveSteps, deriveVariableChanges, deriveVariables } from "../events";
import { createSandbox, type Sandbox } from "../test-support";
import { reentryUpdate } from "./resume-point";
import {
	command,
	drive,
	edge,
	flowOf,
	payloads,
	startRun,
} from "./test-support";

/**
 * Variables on the compiled graph: the values a flow starts with
 * (`VariablesSet`), the writes a node makes when its step ends
 * (`StepEnded.variables`), what templates and rules read (`vars`), and one
 * set of variables per flow invocation.
 */

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(async () => {
	await sandbox.cleanup();
});

const bounded = (
	id: string,
	from: string,
	outcome: string,
	to: string,
	max: number,
): FlowEdge => ({ id, from, outcome, to, max });

/**
 * `check` fails until it has failed twice. Each failure goes into
 * `failures`, and `tries` counts them; a rule on `tries` decides when to
 * stop, and `report` reads both.
 */
const retry = flowOf(
	[
		command("check", `echo "try {{vars.tries}}"; test {{vars.tries}} -ge 2`, {
			set: [
				{
					variable: "failures",
					on: ["fail"],
					expression: "$append(vars.failures, check.log_tail)",
				},
				{ variable: "tries", on: ["fail"], expression: "vars.tries + 1" },
				{ variable: "last", value: "{{check.outcome}} at {{vars.tries}}" },
			],
		}),
		command("report", `echo "{{vars.failures}} {{vars.last}}"`),
	],
	[
		bounded("again", "check", "fail", "check", 5),
		edge("done", "check", "pass", "report"),
	],
	{
		variables: [
			{ name: "failures", type: "json", initial: "[]" },
			{ name: "tries", type: "number", initial: "{{start}}" },
			{ name: "last", type: "text" },
		],
		inputs: [{ name: "start", type: "text", default: "0" }],
	},
);

describe("variables", () => {
	test("a flow starts with its initial values, and each step's writes change them", async () => {
		const h = await startRun(sandbox, retry);
		const { parked, state } = await drive(h, { inputs: { start: "0" } });
		expect(parked).toEqual([]);
		expect(state.ended?.nodeId).toBe("report");
		expect(state.vars).toEqual({
			failures: ["try 0", "try 1"],
			tries: 2,
			last: "pass at 2",
		});

		const logged = await h.events();
		expect(payloads(logged, "VariablesSet")).toEqual([
			{ values: { failures: [], tries: 0, last: null }, scope: null },
		]);
		expect(
			payloads(logged, "StepEnded").map((p) => p.variables ?? null),
		).toEqual([
			{ failures: ["try 0"], tries: 1, last: "fail at 1" },
			{ failures: ["try 0", "try 1"], tries: 2, last: "fail at 2" },
			{ last: "pass at 2" },
			null,
		]);
		const report = deriveSteps(logged).find((s) => s.nodeId === "report");
		expect(report?.outputs.log_tail).toBe('["try 0","try 1"] pass at 2');
		// The log alone gives the same values: a run re-entered without a
		// checkpoint starts from them.
		expect(deriveVariables(logged)).toEqual(state.vars);
		expect(reentryUpdate(retry, logged).vars).toEqual(state.vars);
		// The run page's history: each value, with the step that wrote it.
		const tries = deriveVariableChanges(logged).filter(
			(c) => c.name === "tries",
		);
		const checks = deriveSteps(logged).filter((s) => s.nodeId === "check");
		expect(tries.map((c) => [c.value, c.stepId, c.scope])).toEqual([
			[0, null, null],
			[1, checks[0]?.id ?? null, null],
			[2, checks[1]?.id ?? null, null],
		]);
	});

	test("a rule reads vars", async () => {
		const flow = flowOf(
			[
				command("count", "true", {
					set: [{ variable: "n", expression: "vars.n + 1" }],
				}),
				{
					id: "enough",
					type: "decision",
					position: { x: 0, y: 0 },
					prompt: "",
					by: "rule",
					options: [{ name: "stop", when: "vars.n >= 3" }, { name: "again" }],
				},
			],
			[
				edge("judge", "count", "pass", "enough"),
				bounded("loop", "enough", "again", "count", 5),
			],
			{ variables: [{ name: "n", type: "number", initial: "0" }] },
		);
		const h = await startRun(sandbox, flow);
		const { state } = await drive(h, { inputs: {} });
		expect(state.ended).toMatchObject({ nodeId: "enough", outcome: "stop" });
		expect(state.vars).toEqual({ n: 3 });
	});

	test("a write that does not fit ends the step error and parks the run", async () => {
		const flow = flowOf(
			[
				command("check", "echo nope", {
					set: [{ variable: "tries", value: "{{check.log_tail}}" }],
				}),
				command("after", "true"),
			],
			[edge("e1", "check", "pass", "after")],
			{ variables: [{ name: "tries", type: "number", initial: "0" }] },
		);
		const h = await startRun(sandbox, flow);
		const { parked, state } = await drive(h, { inputs: {} });
		expect(parked).toEqual([
			expect.objectContaining({
				kind: "parked",
				status: "failed",
				reason:
					'Node "check" failed: Could not set "tries": a number is needed, and the value is "nope".',
			}),
		]);
		expect(state.vars).toEqual({ tries: 0 });
		const ended = payloads(await h.events(), "StepEnded");
		expect(ended).toEqual([
			expect.objectContaining({
				outcome: "error",
				error:
					'Could not set "tries": a number is needed, and the value is "nope".',
			}),
		]);
		expect(ended[0]?.variables).toBeUndefined();
	});

	test("an initial value that does not fit parks the run before its first step", async () => {
		const flow = flowOf([command("first", "true")], [], {
			inputs: [{ name: "count", type: "text" }],
			variables: [{ name: "n", type: "number", initial: "{{count}}" }],
		});
		const h = await startRun(sandbox, flow);
		const { parked } = await drive(h, { inputs: { count: "many" } });
		expect(parked).toEqual([
			expect.objectContaining({
				kind: "parked",
				status: "failed",
				stepId: null,
				reason:
					'Could not set "n": a number is needed, and the value is "many".',
			}),
		]);
		expect(await h.types()).toEqual(["RunStarted"]);
	});

	test("a flow without variables has no init node and logs none", async () => {
		const h = await startRun(sandbox, flowOf([command("only", "true")]));
		const { state } = await drive(h, { inputs: {} });
		expect(state.vars).toEqual({});
		expect(await h.types()).toEqual(["RunStarted", "StepStarted", "StepEnded"]);
	});

	test("each call of a flow has its own variables, and the caller's stay its own", async () => {
		const counter = flowOf(
			[
				command("peek", `echo "caller:{{vars.mine}}"`, {
					set: [{ variable: "count", expression: "vars.count + 1" }],
				}),
			],
			[],
			{
				variables: [{ name: "count", type: "number", initial: "{{from}}" }],
				inputs: [{ name: "from", type: "text", default: "10" }],
				outputs: [
					{ name: "count", value: "{{vars.count}}" },
					{ name: "peeked", value: "{{peek.log_tail}}" },
				],
			},
		);
		const call = (id: string, from: string) =>
			({
				id,
				type: "call",
				position: { x: 0, y: 0 },
				flow: "counter",
				inputs: { from },
			}) as const;
		const flow = flowOf(
			[
				call("first", "{{vars.mine}}"),
				call("second", "{{vars.mine}}"),
				command("after", `echo "{{first.count}} {{second.count}}"`),
			],
			[
				edge("e1", "first", "pass", "second"),
				edge("e2", "second", "pass", "after"),
			],
			{ variables: [{ name: "mine", type: "number", initial: "5" }] },
		);
		const h = await startRun(sandbox, flow, { flows: { counter } });
		const { parked, state } = await drive(h, { inputs: {} });
		expect(parked).toEqual([]);
		expect(state.vars).toEqual({ mine: 5 });

		const logged = await h.events();
		const steps = deriveSteps(logged);
		const first = steps.find((s) => s.nodeId === "first");
		const second = steps.find((s) => s.nodeId === "second");
		if (!first || !second) throw new Error("both calls ran");
		// Both start from the caller's value, bound as an input, and neither
		// sees the other's write or the caller's variable.
		expect(first.outputs).toMatchObject({ count: 6, peeked: "caller:" });
		expect(second.outputs).toMatchObject({ count: 6, peeked: "caller:" });
		expect(payloads(logged, "VariablesSet")).toEqual([
			{ values: { mine: 5 }, scope: null },
			{
				values: { count: 5 },
				scope: { parentStepId: first.id, itemId: null },
			},
			{
				values: { count: 5 },
				scope: { parentStepId: second.id, itemId: null },
			},
		]);
		expect(deriveVariables(logged, `${first.id}/`)).toEqual({ count: 6 });
	});
});
