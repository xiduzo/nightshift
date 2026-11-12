import { describe, expect, test } from "bun:test";
import type { TemplateContext } from "./context";
import {
	chooseByRule,
	evaluateRule,
	isTruthy,
	rewriteRuleNames,
	rewriteRuleVariables,
	ruleContext,
	ruleItemRefs,
	ruleNames,
	ruleProblem,
	ruleRefs,
	ruleVariableNames,
	signalOutcome,
} from "./rule";

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
		due_at: "",
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

	test("each place a rule reads a name, with the plain keys after it", () => {
		expect(
			ruleRefs(
				"$count(scout.data.tasks[done = false].title) > 3 and check.outcome = 'pass' and scout",
			),
		).toEqual([
			{ name: "scout", path: ["data", "tasks"] },
			{ name: "check", path: ["outcome"] },
			{ name: "scout", path: [] },
		]);
		expect(ruleRefs("build[0].data.x")).toEqual([{ name: "build", path: [] }]);
		expect(ruleRefs("build.data.(a + b)")).toEqual([
			{ name: "build", path: ["data"] },
		]);
		expect(ruleRefs("$x.y")).toEqual([]);
		expect(ruleRefs("broken (")).toEqual([]);
	});
});

describe("a rule that reads through its root", () => {
	test("$$ is the rule's values everywhere, $ only at the top", async () => {
		// What the walk below must follow: JSONata's own reading.
		expect(await evaluateRule("$$.build.data.tests_passed", context)).toBe(
			true,
		);
		expect(await evaluateRule("$.build.outcome", context)).toBe("pass");
		expect(
			await evaluateRule('[1, 2][$$.build.outcome = "pass"]', context),
		).toEqual([1, 2]);
		// In a filter, `$` is the value it tests.
		expect(await evaluateRule('[{ "mode": 1 }][$.mode = 1]', context)).toEqual({
			mode: 1,
		});
	});

	test("ruleRefs reads a name after $$ anywhere, and after $ at the top", () => {
		expect(ruleRefs("$$.scout.data.tasks[0].title = 'x'")).toEqual([
			{ name: "scout", path: ["data", "tasks"] },
		]);
		expect(ruleRefs("$.scout.outcome and $$.`my-input`")).toEqual([
			{ name: "scout", path: ["outcome"] },
			{ name: "my-input", path: [] },
		]);
		expect(ruleNames("other.data[$$.scout.data.x = id]")).toEqual([
			"other",
			"scout",
		]);
		expect(ruleNames("$$.(scout.ok) and $$[check.ok]")).toEqual([
			"scout",
			"check",
		]);
		expect(ruleNames("$$ and $")).toEqual([]);
	});

	test("a filter or a grouping reads each value, not the rule's names", () => {
		expect(ruleNames("other.data[$.scout = 1]")).toEqual(["other"]);
		expect(ruleNames("(scout.data.tasks)[done]")).toEqual(["scout"]);
		expect(ruleNames("$x[scout = 1] and [1, 2][$.check]")).toEqual([]);
		expect(ruleNames("scout.data{ kind: $count(other) }")).toEqual(["scout"]);
	});

	test("rewriteRuleNames follows $$, and $ at the top", () => {
		const toFinder = (name: string) =>
			name === "scout" ? "finder" : undefined;
		expect(
			rewriteRuleNames(
				"$$.scout.data and other[$$.`scout` = 1] and $.scout and other[$.scout]",
				toFinder,
			),
		).toBe(
			"$$.finder.data and other[$$.`finder` = 1] and $.finder and other[$.scout]",
		);
	});
});

describe("a name a rule reads inside a filter", () => {
	const listed: TemplateContext = {
		...context,
		vars: { limit: 2 },
		nodes: {
			...context.nodes,
			scout: { outcome: "pass", data: { tasks: [{ p: 1 }, { p: 3 }] } },
		},
	};

	test("JSONata reads it as a key of each item: only $$ reads the rule's value", async () => {
		// What ruleItemRefs must find: the form that silently reads nothing.
		expect(
			await evaluateRule("scout.data.tasks[p > vars.limit]", listed),
		).toBeUndefined();
		expect(
			await evaluateRule("scout.data.tasks.(p > vars.limit)", listed),
		).toBeUndefined();
		expect(
			await evaluateRule("scout.data.tasks[p > $$.vars.limit]", listed),
		).toEqual({ p: 3 });
		// A function's body reads the rule's values where it was written.
		expect(
			await evaluateRule(
				"$filter(scout.data.tasks, function($t) { $t.p > vars.limit })",
				listed,
			),
		).toEqual({ p: 3 });
	});

	test("ruleItemRefs: a path that starts with a name in a filter, a step, a sort or a grouping", () => {
		expect(
			ruleItemRefs(
				"scout.data.tasks[p > vars.limit and other.data.x[0] = `my-input`]",
			),
		).toEqual([
			{ name: "p", read: "p" },
			{ name: "vars", read: "vars.limit" },
			{ name: "other", read: "other.data.x" },
			{ name: "my-input", read: "`my-input`" },
		]);
		expect(
			ruleItemRefs(
				'tasks.(vars.limit) and tasks^(run.index) and t{"k": check}',
			),
		).toEqual([
			{ name: "vars", read: "vars.limit" },
			{ name: "run", read: "run.index" },
			{ name: "check", read: "check" },
		]);
	});

	test("ruleItemRefs leaves out $$, $, the top of the rule and a function's body", () => {
		expect(
			ruleItemRefs(
				"scout.data.tasks[$.p > $$.vars.limit] and vars.limit > 1 and $filter(scout.data.tasks, function($t) { $t.p > vars.limit })",
			),
		).toEqual([]);
		expect(ruleItemRefs("tasks[p > (")).toEqual([]);
	});
});

describe("the variables a rule reads", () => {
	test("ruleVariableNames: the name after vars where a path starts", () => {
		expect(
			ruleVariableNames(
				"vars.tries + $$.vars.limit > vars.tries and items[vars.max = 1]",
			),
		).toEqual(["tries", "limit", "max"]);
		expect(
			ruleVariableNames(
				'"vars.a" & $x.vars.b & other.vars.c & vars /* vars.d */',
			),
		).toEqual([]);
		expect(ruleVariableNames("vars.tries = (")).toEqual([]);
	});

	test("rewriteRuleVariables renames each read, the rest stays byte for byte", () => {
		const toN = (name: string) => (name === "tries" ? "n" : undefined);
		expect(
			rewriteRuleVariables(
				"vars.tries  +\n  $$.vars.`tries` > vars.tries_2 and items[vars.tries = 1]",
				toN,
			),
		).toBe("vars.n  +\n  $$.vars.`n` > vars.tries_2 and items[vars.n = 1]");
	});

	test("rewriteRuleVariables leaves strings, comments and other paths alone", () => {
		const rule =
			"\"vars.tries\" & 'vars.tries' & $x.vars.tries & other.vars.tries & $vars.tries /* vars.tries */";
		expect(rewriteRuleVariables(rule, () => "n")).toBe(rule);
		expect(rewriteRuleVariables("vars.tries = (", () => "n")).toBe(
			"vars.tries = (",
		);
	});

	test("rewriteRuleVariables puts a new name JSONata cannot take bare in backticks", () => {
		expect(rewriteRuleVariables("vars.tries > 1", () => "and")).toBe(
			"vars.`and` > 1",
		);
	});
});

describe("rewriteRuleNames", () => {
	const toFinder = (name: string) => (name === "scout" ? "finder" : undefined);

	test("rewrites each top-level name, the rest of the text stays", () => {
		expect(
			rewriteRuleNames(
				"$count(scout.data.tasks[done = false]) > 3 and\n  scout.outcome = 'pass' ? scout : other",
				toFinder,
			),
		).toBe(
			"$count(finder.data.tasks[done = false]) > 3 and\n  finder.outcome = 'pass' ? finder : other",
		);
		expect(
			rewriteRuleNames('{ "a": scout.data, scout: [scout] }', toFinder),
		).toBe('{ "a": finder.data, finder: [finder] }');
		expect(
			rewriteRuleNames("scout.data ~> $map(function($v){ scout })", toFinder),
		).toBe("finder.data ~> $map(function($v){ finder })");
	});

	test("keeps a name in backticks in backticks", () => {
		expect(rewriteRuleNames("`scout`.data and ( scout ).ok", toFinder)).toBe(
			"`finder`.data and ( finder ).ok",
		);
	});

	test("leaves strings, variables, comments, keys and longer names alone", () => {
		const rule =
			"\"scout\" & 'scout' & $scout & $scout() & other.scout & other[scout = 1] & scout_2 /* scout */";
		expect(rewriteRuleNames(rule, toFinder)).toBe(rule);
	});

	test("puts a new name JSONata cannot take bare in backticks", () => {
		expect(rewriteRuleNames("scout.x and scout", () => "and")).toBe(
			"`and`.x and `and`",
		);
		expect(rewriteRuleNames("scout = 1", () => "my-node")).toBe(
			"`my-node` = 1",
		);
	});

	test("leaves a rule that is not valid as it is", () => {
		expect(rewriteRuleNames("scout.data = (", toFinder)).toBe("scout.data = (");
	});
});

describe("signalOutcome", () => {
	const rules = [
		{ outcome: "green", when: 'event.body.conclusion = "success"' },
		{
			outcome: "red",
			when: 'event.body.conclusion in ["failure", "timed_out"]',
		},
		{ outcome: "broken", when: "$number(event.body.conclusion) > 1" },
	];

	test("the first rule that holds over the event picks its outcome", async () => {
		expect(
			await signalOutcome(rules, { body: { conclusion: "timed_out" } }),
		).toBe("red");
	});

	test("none holds, or a rule fails on the data: null", async () => {
		expect(
			await signalOutcome(rules, { body: { conclusion: "neutral" } }),
		).toBeNull();
		expect(await signalOutcome(rules, undefined)).toBeNull();
	});
});
