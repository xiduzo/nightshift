import { describe, expect, test } from "bun:test";
import type { TemplateContext } from "./context";
import { renderTemplate } from "./template";
import {
	applyVariableWrites,
	coerceVariable,
	initialVariables,
	MAX_VARIABLE_BYTES,
	writesOn,
} from "./variables";

const run: TemplateContext["run"] = {
	branch: "nightshift/fix",
	base_branch: "",
	index: "",
	worktree: "/tmp/wt",
	base_ref: "main",
	flow: "retry",
};

describe("coerceVariable", () => {
	test("text reads as the type; a value must be of the type", () => {
		expect(coerceVariable("number", " 3 ", true)).toEqual({
			ok: true,
			value: 3,
		});
		expect(coerceVariable("number", 4, false)).toEqual({ ok: true, value: 4 });
		expect(coerceVariable("boolean", "True", true)).toEqual({
			ok: true,
			value: true,
		});
		expect(coerceVariable("text", 7, false)).toEqual({ ok: true, value: "7" });
		expect(coerceVariable("json", "[1, 2]", true)).toEqual({
			ok: true,
			value: [1, 2],
		});
		expect(coerceVariable("json", "plain", false)).toEqual({
			ok: true,
			value: "plain",
		});
	});

	test("null fits every type", () => {
		for (const type of ["text", "number", "boolean", "json"] as const) {
			expect(coerceVariable(type, null, false)).toEqual({
				ok: true,
				value: null,
			});
		}
	});

	test("a value that does not fit says what is needed", () => {
		expect(coerceVariable("number", "abc", true)).toEqual({
			ok: false,
			problem: 'a number is needed, and the value is "abc".',
		});
		expect(coerceVariable("text", { a: 1 }, false)).toEqual({
			ok: false,
			problem: 'text is needed, and the value is {"a":1}.',
		});
		expect(coerceVariable("json", "{nope", true)).toEqual({
			ok: false,
			problem: 'JSON is needed, and the value is not valid JSON: "{nope".',
		});
	});
});

describe("initialVariables", () => {
	test("renders each initial over the inputs and run, unset is null", () => {
		const result = initialVariables(
			{
				variables: [
					{ name: "issue", type: "number", initial: "{{item.number}}" },
					{ name: "failures", type: "json", initial: "[]" },
					{ name: "branch", type: "text", initial: "on {{run.branch}}" },
					{ name: "summary", type: "text" },
				],
			},
			{ nodes: {}, inputs: { item: { number: 42 } }, run },
		);
		expect(result).toEqual({
			ok: true,
			values: {
				issue: 42,
				failures: [],
				branch: "on nightshift/fix",
				summary: null,
			},
		});
	});

	test("an initial that does not fit names the variable", () => {
		expect(
			initialVariables(
				{
					variables: [{ name: "tries", type: "number", initial: "{{topic}}" }],
				},
				{ nodes: {}, inputs: { topic: "many" }, run },
			),
		).toEqual({
			ok: false,
			error:
				'Could not set "tries": a number is needed, and the value is "many".',
		});
	});
});

describe("applyVariableWrites", () => {
	const variables = [
		{ name: "failures", type: "json" as const },
		{ name: "tries", type: "number" as const },
		{ name: "summary", type: "text" as const },
	];
	const context: TemplateContext = {
		nodes: { check: { outcome: "fail", log_tail: "2 tests failed" } },
		inputs: {},
		run,
		vars: { failures: ["1 test failed"], tries: 1, summary: null },
	};

	test("writes in order: each write sees the ones before it", async () => {
		const result = await applyVariableWrites({
			node: {
				set: [
					{
						variable: "failures",
						expression: "$append(vars.failures, check.log_tail)",
					},
					{ variable: "tries", expression: "$count(vars.failures)" },
					{
						variable: "summary",
						value: "Try {{vars.tries}}: {{check.log_tail}}",
					},
				],
			},
			variables,
			outcome: "fail",
			context,
		});
		expect(result).toEqual({
			ok: true,
			values: {
				failures: ["1 test failed", "2 tests failed"],
				tries: 2,
				summary: "Try 2: 2 tests failed",
			},
		});
	});

	test("on: only the outcomes it names; a parked step writes nothing", async () => {
		const node = {
			set: [
				{ variable: "tries", on: ["pass"], value: "9" },
				{ variable: "summary", value: "x" },
			],
		};
		expect(
			await applyVariableWrites({ node, variables, outcome: "fail", context }),
		).toEqual({ ok: true, values: { summary: "x" } });
		expect(writesOn({ variable: "summary", value: "x" }, "stopped")).toBe(
			false,
		);
		expect(writesOn({ variable: "summary", value: "x" }, "error")).toBe(false);
	});

	test("a write that does not fit, or an expression that fails, is an error", async () => {
		expect(
			await applyVariableWrites({
				node: { set: [{ variable: "tries", value: "{{check.log_tail}}" }] },
				variables,
				outcome: "fail",
				context,
			}),
		).toEqual({
			ok: false,
			error:
				'Could not set "tries": a number is needed, and the value is "2 tests failed".',
		});
		const failed = await applyVariableWrites({
			node: { set: [{ variable: "tries", expression: "$nope(1)" }] },
			variables,
			outcome: "fail",
			context,
		});
		expect(failed.ok).toBe(false);
		if (!failed.ok) {
			expect(failed.error).toStartWith(
				'Could not set "tries": the expression failed:',
			);
		}
	});

	test("the schema and the size limit hold", async () => {
		const schema = { type: "array" };
		const result = await applyVariableWrites({
			node: { set: [{ variable: "failures", value: "{{check.outcome}}" }] },
			variables: [{ name: "failures", type: "json", schema }],
			outcome: "fail",
			context,
			checkSchema: (s, value) =>
				s === schema && !Array.isArray(value) ? "data must be array" : null,
		});
		expect(result).toEqual({
			ok: false,
			error:
				'Could not set "failures": the value does not match: data must be array.',
		});
		const big = "x".repeat(MAX_VARIABLE_BYTES + 1);
		const tooLarge = await applyVariableWrites({
			node: { set: [{ variable: "summary", value: "{{check.log_tail}}" }] },
			variables,
			outcome: "fail",
			context: { ...context, nodes: { check: { log_tail: big } } },
		});
		expect(tooLarge.ok).toBe(false);
	});
});

describe("templates read vars", () => {
	test("{{vars.x}} and a path into a json variable", () => {
		expect(
			renderTemplate("{{vars.tries}} / {{vars.plan.steps.0}} / {{vars.none}}", {
				nodes: {},
				inputs: {},
				run,
				vars: { tries: 2, plan: { steps: ["a"] } },
			}),
		).toBe("2 / a / ");
	});
});
