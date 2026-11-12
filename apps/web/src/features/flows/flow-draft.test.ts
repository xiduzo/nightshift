import { describe, expect, test } from "bun:test";
import type { NodeSample } from "@nightshift/client";
import { FLOW_VERSION, type Flow, flowSchema } from "@nightshift/flows";

import {
	checkFlow,
	completeTemplate,
	matchVariables,
	openTemplate,
	templateVariables,
} from "./flow-draft";

const flow: Flow = flowSchema.parse({
	version: FLOW_VERSION,
	inputs: [{ name: "start", type: "text" }],
	outputs: [{ name: "result", value: "{{vars.tries}}" }],
	variables: [
		{ name: "tries", type: "number", initial: "{{start}}" },
		{ name: "plan", type: "json", description: "The steps to take" },
	],
	start: "check",
	nodes: [
		{
			id: "check",
			type: "command",
			position: { x: 0, y: 0 },
			command: 'echo "{{vars.tries}} {{vars.tries_2}} {{ vars.plan.steps }}"',
			stdout: "text",
			set: [
				{ variable: "tries", expression: "vars.tries + 1" },
				{ variable: "plan", value: "{{vars.plan}}" },
			],
		},
		{
			id: "enough",
			type: "decision",
			position: { x: 0, y: 0 },
			prompt: "",
			by: "rule",
			options: [
				{ name: "stop", when: "vars.tries >= 3 and vars.tries_2 = 0" },
				{ name: "again" },
			],
		},
	],
	edges: [],
});

describe("completing a template while you type", () => {
	const tries = {
		text: "{{vars.tries}}",
		label: "tries",
		json: false,
	};
	const plan = { text: "{{vars.plan}}", label: "plan", json: true };

	test("an open {{ before the cursor gives the name typed so far", () => {
		expect(openTemplate("Try {{vars.tr", 13)).toEqual({
			start: 4,
			query: "vars.tr",
		});
		expect(openTemplate("Try {{", 6)).toEqual({ start: 4, query: "" });
		expect(openTemplate("Try {{vars.tries}} now", 22)).toBeNull();
		expect(openTemplate("Try {vars", 9)).toBeNull();
	});

	test("only the variables that hold the name stay, in their groups", () => {
		const groups = templateVariables(flow, "check");
		const matches = matchVariables(groups, "TRI");
		expect(matches.map((group) => group.scope)).toEqual(["vars"]);
		expect(matches[0]?.variables.map((variable) => variable.text)).toEqual([
			"{{vars.tries}}",
		]);
		expect(matchVariables(groups, "")).toEqual(groups);
	});

	test("the variable takes the place of what you typed", () => {
		const text = "Try {{vars.tr and stop";
		const open = openTemplate(text, 13);
		if (!open) throw new Error("expected an open template");
		expect(completeTemplate(text, 13, open, tries)).toEqual({
			text: "Try {{vars.tries}} and stop",
			cursor: 18,
		});
	});

	test("a closing }} that is already there is not doubled", () => {
		const text = "Try {{va}} now";
		const open = openTemplate(text, 8);
		if (!open) throw new Error("expected an open template");
		expect(completeTemplate(text, 8, open, tries).text).toBe(
			"Try {{vars.tries}} now",
		);
	});

	test("a JSON value leaves the cursor before the closing braces", () => {
		const open = openTemplate("{{pl", 4);
		if (!open) throw new Error("expected an open template");
		expect(completeTemplate("{{pl", 4, open, plan)).toEqual({
			text: "{{vars.plan}}",
			cursor: 11,
		});
	});
});

describe("what each variable held in the newest run", () => {
	const sample = (
		outputs: NodeSample["outputs"],
		fields: Partial<NodeSample> = {},
	): NodeSample => ({
		runId: "run",
		stepId: "step",
		endedAt: 100,
		outcome: "pass",
		outputs,
		inputs: { start: "3" },
		changed: false,
		...fields,
	});

	test("an input and a node's fields show their value in one line", () => {
		const samples = new Map([
			[
				"check",
				sample({
					outcome: "pass",
					exit_code: 0,
					log_tail: "checking\n2 of 3 sources answered",
				}),
			],
		]);
		const groups = templateVariables(flow, "enough", { samples });
		const of = (scope: string) =>
			Object.fromEntries(
				(groups.find((group) => group.scope === scope)?.variables ?? []).map(
					(variable) => [variable.text, variable.sample],
				),
			);
		expect(of("inputs")).toEqual({ "{{start}}": "3" });
		expect(of("check")).toMatchObject({
			"{{check.exit_code}}": "0",
			"{{check.log_tail}}": "2 of 3 sources answered",
		});
		expect(of("vars")["{{vars.tries}}"]).toBeUndefined();
		expect(Object.values(of("run")).every((value) => value === undefined)).toBe(
			true,
		);
	});

	test("the inputs come from the newest sample's run", () => {
		const samples = new Map([
			["check", sample({}, { endedAt: 100, inputs: { start: "old" } })],
			["enough", sample({}, { endedAt: null, inputs: { start: "new" } })],
		]);
		const inputs = templateVariables(flow, null, { samples }).find(
			(group) => group.scope === "inputs",
		);
		expect(inputs?.variables[0]?.sample).toBe("new");
	});

	test("without samples, no variable has one", () => {
		const groups = templateVariables(flow, "enough");
		expect(
			groups.every((group) =>
				group.variables.every((variable) => variable.sample === undefined),
			),
		).toBe(true);
	});
});

describe("checkFlow: a project without a folder", () => {
	const draft: Flow = flowSchema.parse({
		version: FLOW_VERSION,
		start: "publish",
		nodes: [
			{
				id: "publish",
				type: "call",
				position: { x: 0, y: 0 },
				flow: "kit:github/publish-draft-pr",
				inputs: { title: "Notes" },
			},
			{
				id: "note",
				type: "command",
				position: { x: 0, y: 0 },
				command: 'echo "{{run.branch}}"',
			},
		],
		edges: [],
	});
	const warnings = (folder?: boolean) =>
		checkFlow(draft, {}, "ship", undefined, undefined, undefined, folder)
			.issues.filter((issue) => issue.severity === "warning")
			.filter((issue) => issue.message.includes("folder"));

	test("each step that needs the folder warns, in the editor's words", () => {
		expect(warnings(false)).toEqual([
			{
				severity: "warning",
				message:
					'"Publish a draft pull request" works in the project\'s folder. This project has no folder, so this step fails.',
				nodeId: "publish",
			},
			{
				severity: "warning",
				message:
					"{{run.branch}} is always empty. A project without a folder has no branches.",
				nodeId: "note",
			},
		]);
	});

	test("a project with a folder, or one that is still loading, gets no warning", () => {
		expect(warnings(true)).toEqual([]);
		expect(warnings()).toEqual([]);
	});
});

describe("templateVariables: a project without a folder", () => {
	const run = (folder?: boolean) =>
		templateVariables(flow, "check", { folder })
			.find((group) => group.scope === "run")
			?.variables.map((variable) => variable.text);

	test("the run offers no branch and no base: they are always empty there", () => {
		expect(run(false)).toEqual([
			"{{run.index}}",
			"{{run.worktree}}",
			"{{run.flow}}",
			"{{run.due_at}}",
		]);
	});

	test("a project with a folder, or one that is still loading, offers them", () => {
		const all = [
			"{{run.branch}}",
			"{{run.base_branch}}",
			"{{run.index}}",
			"{{run.worktree}}",
			"{{run.base_ref}}",
			"{{run.flow}}",
			"{{run.due_at}}",
		];
		expect(run(true)).toEqual(all);
		expect(run()).toEqual(all);
	});
});
