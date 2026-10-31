import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { FlowEdge } from "@nightshift/flows";
import { foldRun } from "../log";

import { deriveSteps, deriveVariables } from "../read/run-views";
import {
	command,
	drive,
	edge,
	flowOf,
	payloads,
	startRun,
} from "../testing/graph";
import { createSandbox, type Sandbox } from "../testing/test-support";
import { listKeptValues, resetKeptValue } from "../variables";
import { reentryUpdate } from "./reentry";

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
		const report = deriveSteps(foldRun(logged)).find(
			(s) => s.nodeId === "report",
		);
		expect(report?.outputs.log_tail).toBe('["try 0","try 1"] pass at 2');
		// The log alone gives the same values: a run re-entered without a
		// checkpoint starts from them.
		expect(deriveVariables(foldRun(logged))).toEqual(state.vars);
		expect(reentryUpdate(retry, foldRun(logged)).vars).toEqual(state.vars);
		// The run page's history: each value, with the step that wrote it.
		const tries = foldRun(logged).variableChanges.filter(
			(c) => c.name === "tries",
		);
		const checks = deriveSteps(foldRun(logged)).filter(
			(s) => s.nodeId === "check",
		);
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
		const steps = deriveSteps(foldRun(logged));
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
		expect(deriveVariables(foldRun(logged), `${first.id}/`)).toEqual({
			count: 6,
		});
	});

	describe("kept between runs", () => {
		/**
		 * `skip` adds the input's number to `skipped`, a kept list, unless
		 * it is in it already; `count` is not kept.
		 */
		const skipper = flowOf(
			[
				command("skip", `echo "seen {{vars.skipped}}"`, {
					set: [
						{
							variable: "skipped",
							expression:
								"$number(issue) in vars.skipped ? vars.skipped : $append(vars.skipped, $number(issue))",
						},
						{ variable: "count", expression: "vars.count + 1" },
					],
				}),
			],
			[],
			{
				variables: [
					{ name: "skipped", type: "json", initial: "[]", keep: "project" },
					{ name: "count", type: "number", initial: "0" },
				],
				inputs: [{ name: "issue", type: "text" }],
			},
		);
		const kept = (flowName: string) => ({
			spaceId: sandbox.spaceId,
			projectId: "project-1",
			flowName,
		});
		const runOf = async (issue: string, flowName = "skipper") => {
			const h = await startRun(sandbox, skipper, {
				flowName,
				inputs: { issue },
			});
			const driven = await drive(h, { inputs: { issue } });
			expect(driven.parked).toEqual([]);
			return { h, state: driven.state, logged: await h.events() };
		};

		test("a run starts from the value the last run kept, and each write saves it", async () => {
			const first = await runOf("12");
			expect(first.state.vars).toEqual({ skipped: [12], count: 1 });
			expect(payloads(first.logged, "VariablesSet")).toEqual([
				{ values: { skipped: [], count: 0 }, scope: null },
			]);

			const second = await runOf("14");
			expect(second.state.vars).toEqual({ skipped: [12, 14], count: 1 });
			// The log says which start value came from an earlier run.
			expect(payloads(second.logged, "VariablesSet")).toEqual([
				{ values: { skipped: [12], count: 0 }, scope: null, kept: ["skipped"] },
			]);
			expect(
				foldRun(second.logged)
					.variableChanges.filter((c) => c.stepId === null)
					.map((c) => [c.name, c.kept ?? false]),
			).toEqual([
				["skipped", true],
				["count", false],
			]);

			const third = await runOf("12");
			expect(third.state.vars).toEqual({ skipped: [12, 14], count: 1 });
			// Only the kept variable is saved.
			const values = await listKeptValues(sandbox.db, kept("skipper"));
			expect(values.map((v) => [v.name, v.value, v.runId])).toEqual([
				["skipped", [12, 14], third.h.runId],
			]);
		});

		test("each flow keeps its own, and a reset starts from initial again", async () => {
			await runOf("12");
			const other = await runOf("30", "other");
			expect(other.state.vars).toEqual({ skipped: [30], count: 1 });

			await resetKeptValue(sandbox.db, kept("skipper"), "skipped");
			expect(await listKeptValues(sandbox.db, kept("skipper"))).toEqual([]);
			const fresh = await runOf("14");
			expect(fresh.state.vars).toEqual({ skipped: [14], count: 1 });
			expect(
				(await listKeptValues(sandbox.db, kept("other"))).map((v) => v.value),
			).toEqual([[30]]);
		});

		test("a quick run keeps nothing", async () => {
			const h = await startRun(sandbox, skipper, { inputs: { issue: "12" } });
			await drive(h, { inputs: { issue: "12" } });
			expect(await listKeptValues(sandbox.db, kept("test"))).toEqual([]);
		});

		test("a called flow keeps its own, by its flow name", async () => {
			const call = {
				id: "call",
				type: "call",
				position: { x: 0, y: 0 },
				flow: "skipper",
				inputs: { issue: "{{issue}}" },
			} as const;
			const caller = flowOf([call], [], {
				inputs: [{ name: "issue", type: "text" }],
			});
			for (const issue of ["7", "8"]) {
				const h = await startRun(sandbox, caller, {
					flowName: "caller",
					flows: { skipper },
					inputs: { issue },
				});
				expect((await drive(h, { inputs: { issue } })).parked).toEqual([]);
			}
			expect(
				(await listKeptValues(sandbox.db, kept("skipper"))).map((v) => v.value),
			).toEqual([[7, 8]]);
			expect(await listKeptValues(sandbox.db, kept("caller"))).toEqual([]);
		});
	});
});
