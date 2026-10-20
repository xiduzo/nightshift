import { describe, expect, test } from "bun:test";
import {
	chooseByRule,
	evaluateRule,
	isTruthy,
	ruleContext,
	ruleNames,
	ruleProblem,
} from "./rule";
import type { TemplateContext } from "./types";

const context: TemplateContext = {
	nodes: {
		build: {
			outcome: "pass",
			data: { tests_passed: true, failed: 0 },
			visit: 1,
		},
		check: { outcome: "fail", exit_code: 2, log_tail: "boom", visit: 2 },
		"my-node": { outcome: "pass", visit: 1 },
	},
	inputs: { mode: "fast", limits: { max: 3 }, check: "an input wins" },
	run: {
		branch: "feature/x",
		base_branch: "main",
		index: "0",
		worktree: "/tmp/wt",
		base_ref: "main",
		flow: "night",
	},
};

describe("ruleContext", () => {
	test("one object: run, vars, then the inputs, then the nodes, with the template lookup's precedence", () => {
		const ctx = ruleContext(context);
		expect(Object.keys(ctx).sort()).toEqual([
			"build",
			"check",
			"limits",
			"mode",
			"my-node",
			"run",
			"vars",
		]);
		expect(ctx.check).toBe("an input wins");
		expect(ctx.run).toEqual(context.run);
		expect(ctx.build).toEqual(context.nodes.build ?? {});
	});
});

/** The same values, without an input that shadows the node `check`. */
const plain: TemplateContext = {
	...context,
	inputs: { mode: "fast", limits: { max: 3 } },
};

describe("evaluateRule", () => {
	test("reads typed values from data and outputs", async () => {
		expect(
			await evaluateRule(
				"check.exit_code = 2 and check.outcome = 'fail'",
				plain,
			),
		).toBe(true);
		expect(await evaluateRule("check.exit_code", plain)).toBe(2);
		expect(await evaluateRule("build.data.failed", plain)).toBe(0);
		expect(await evaluateRule("limits.max > 2", plain)).toBe(true);
		expect(await evaluateRule("mode = 'fast'", plain)).toBe(true);
		expect(await evaluateRule("$contains(run.branch, 'feature/')", plain)).toBe(
			true,
		);
	});

	test("a name JSONata cannot take bare goes in backticks", async () => {
		expect(await evaluateRule("`my-node`.outcome = 'pass'", plain)).toBe(true);
	});

	test("a missing value is undefined, and compares as false", async () => {
		expect(await evaluateRule("ghost.data.ok", plain)).toBeUndefined();
		expect(await evaluateRule("ghost.data.ok = true", plain)).toBe(false);
	});

	test("throws JSONata's message on a bad expression or a failed evaluation", async () => {
		await expect(evaluateRule("check.(", plain)).rejects.toThrow(
			'Expected ")" before end of expression',
		);
		await expect(evaluateRule("$error('nope')", plain)).rejects.toThrow("nope");
	});
});

describe("isTruthy", () => {
	test("JSONata's $boolean rules", () => {
		expect(isTruthy(true)).toBe(true);
		expect(isTruthy(false)).toBe(false);
		expect(isTruthy(undefined)).toBe(false);
		expect(isTruthy(null)).toBe(false);
		expect(isTruthy(0)).toBe(false);
		expect(isTruthy(2)).toBe(true);
		expect(isTruthy("")).toBe(false);
		expect(isTruthy("x")).toBe(true);
		expect(isTruthy([])).toBe(false);
		expect(isTruthy([0, ""])).toBe(false);
		expect(isTruthy([0, "x"])).toBe(true);
		expect(isTruthy({})).toBe(false);
		expect(isTruthy({ a: 1 })).toBe(true);
	});
});

describe("chooseByRule", () => {
	test("the first option whose rule holds wins, and the rules after it are not evaluated", async () => {
		const outcome = await chooseByRule(
			[
				{
					name: "ship",
					when: "build.data.tests_passed = true and check.exit_code = 0",
				},
				{ name: "retry", when: "check.exit_code = 2" },
				{ name: "also", when: "check.exit_code = 2" },
				{ name: "stop" },
			],
			plain,
		);
		expect(outcome).toEqual({
			matched: "retry",
			evaluated: [
				{ option: "ship", result: false },
				{ option: "retry", result: true },
			],
		});
	});

	test("an option without a rule is the default", async () => {
		const outcome = await chooseByRule(
			[{ name: "ship", when: "check.exit_code = 0" }, { name: "stop" }],
			plain,
		);
		expect(outcome).toEqual({
			matched: "stop",
			evaluated: [
				{ option: "ship", result: false },
				{ option: "stop", result: null },
			],
		});
	});

	test("an empty rule counts as no rule", async () => {
		const outcome = await chooseByRule([{ name: "go", when: "  " }], plain);
		expect(outcome.matched).toBe("go");
	});

	test("no match and no default: matched is null, with every rule's value", async () => {
		const outcome = await chooseByRule(
			[
				{ name: "ship", when: "check.exit_code = 0" },
				{ name: "none", when: "ghost.x" },
			],
			plain,
		);
		expect(outcome).toEqual({
			matched: null,
			evaluated: [
				{ option: "ship", result: false },
				{ option: "none", result: null },
			],
		});
	});

	test("a rule that fails throws, naming the option", async () => {
		await expect(
			chooseByRule(
				[
					{ name: "ship", when: "check.exit_code = 0" },
					{ name: "bad", when: "$error('boom')" },
				],
				plain,
			),
		).rejects.toThrow('The rule of option "bad" failed: boom');
	});

	test("a rule may give a value that is not a boolean: JSONata's truth decides", async () => {
		const outcome = await chooseByRule(
			[
				{ name: "none", when: "build.data.failed" },
				{ name: "some", when: "check.log_tail" },
			],
			plain,
		);
		expect(outcome.matched).toBe("some");
	});
});

describe("ruleProblem and ruleNames", () => {
	test("a rule that does not parse has a problem", () => {
		expect(ruleProblem("a = 1")).toBeNull();
		expect(ruleProblem("a = (")).toContain('Expected ")"');
	});

	test("the top-level names a rule reads, best effort", () => {
		expect(
			ruleNames(
				"build.data.tests_passed = true and check.exit_code = 0 or $contains(run.branch, 'x') or `my-input`",
			),
		).toEqual(["build", "check", "run", "my-input"]);
		expect(ruleNames("$x.y")).toEqual([]);
		expect(ruleNames("build.data[tests_passed = true]")).toEqual(["build"]);
		expect(ruleNames("$count(planner.data.tasks) > 3")).toEqual(["planner"]);
		expect(ruleNames("broken (")).toEqual([]);
	});
});
