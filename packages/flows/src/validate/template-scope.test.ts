import { describe, expect, test } from "bun:test";
import { FLOW_VERSION, type Flow, type FlowInput, flowSchema } from "../flow";
import { validateFlow } from "./flow";
import type { ProjectFlowMap } from "./issues";
import {
	calledFlow,
	type TemplateField,
	type TemplateScope,
	templateScope,
} from "./template-scope";

const at = { x: 0, y: 0 };

/** A flow that `main` calls once: its output holds JSON. */
const review: Flow = flowSchema.parse({
	version: FLOW_VERSION,
	outputs: [
		{
			name: "verdict",
			value: "{{look.log_tail}}",
			description: "What the review found",
		},
	],
	start: "look",
	nodes: [{ id: "look", type: "command", position: at, command: "true" }],
	edges: [],
});

/** A flow that `main` runs per element. */
const task: Flow = flowSchema.parse({
	version: FLOW_VERSION,
	inputs: [{ name: "item", type: "json", required: true }],
	start: "work",
	nodes: [
		{ id: "work", type: "command", position: at, command: "echo {{item}}" },
	],
	edges: [],
});

/** Every node type that adds a rule to the scope, and `use`, whose command reads them. */
function mainFlow(use = "true"): Flow {
	const input: FlowInput = {
		version: FLOW_VERSION,
		inputs: [
			{ name: "topic", type: "text", description: "What to work on" },
			{ name: "spec", type: "json", label: "Spec" },
		],
		variables: [
			{ name: "tries", type: "number" },
			{ name: "plan", type: "json", description: "The steps" },
		],
		start: "planner",
		nodes: [
			{
				id: "planner",
				type: "agent",
				position: at,
				prompt: "Plan {{topic}}",
				harness: "claude-code",
				model: "sonnet",
				permissionMode: "acceptEdits",
				output: {
					type: "object",
					properties: { tasks: { type: "array" }, title: { type: "string" } },
				},
				set: [{ variable: "plan", value: "{{planner.data}}" }],
			},
			{ id: "list", type: "command", position: at, command: "ls" },
			{
				id: "read",
				type: "command",
				position: at,
				command: "cat plan.json",
				stdout: "json",
			},
			{
				id: "size",
				type: "value",
				position: at,
				by: "rule",
				expression: '"small"',
				output: { type: "object", properties: { size: { type: "string" } } },
			},
			{
				id: "each",
				type: "call",
				position: at,
				flow: "task",
				each: {
					source: { kind: "json", value: "{{planner.data.tasks}}" },
					as: "item",
				},
			},
			{ id: "sub", type: "call", position: at, flow: "review" },
			{
				id: "pause",
				type: "wait",
				position: at,
				until: { kind: "duration", minutes: 1 },
			},
			{
				id: "use",
				type: "command",
				position: at,
				command: use,
				set: [{ variable: "tries", value: "1" }],
			},
		],
		edges: [
			{ id: "e1", from: "planner", outcome: "pass", to: "list" },
			{ id: "e2", from: "list", outcome: "pass", to: "read" },
			{ id: "e3", from: "read", outcome: "pass", to: "size" },
			{ id: "e4", from: "size", outcome: "pass", to: "each" },
			{ id: "e5", from: "each", outcome: "done", to: "sub" },
			{ id: "e6", from: "sub", outcome: "pass", to: "pause" },
			{ id: "e7", from: "pause", outcome: "done", to: "use" },
		],
	};
	return flowSchema.parse(input);
}

const flows: ProjectFlowMap = { review, task };

/** The errors of `main` when `use` runs `command`. `known`: the project's flows. */
function errorsOf(command: string, known?: ProjectFlowMap): string[] {
	return validateFlow(mainFlow(command), { flows: known, name: "main" })
		.filter((issue) => issue.severity === "error")
		.map((issue) => issue.message);
}

/** Every reference the scope lists, the keys below a field too. */
function refsOf(scope: TemplateScope): string[] {
	const all = (fields: readonly TemplateField[]): string[] =>
		fields.flatMap((field) => [field.ref, ...all(field.keys ?? [])]);
	return [
		...all(scope.inputs),
		...all(scope.vars ?? []),
		...scope.nodes.flatMap((node) => all(node.fields)),
		...all(scope.run),
	];
}

describe("the template scope", () => {
	test("lists the inputs, the variables, each node's fields and the run's", () => {
		const scope = templateScope(mainFlow(), { flows });
		expect(scope.inputs).toMatchObject([
			{
				name: "topic",
				ref: "topic",
				json: false,
				description: "What to work on",
			},
			{ name: "spec", ref: "spec", json: true, description: "Spec" },
		]);
		expect(scope.vars).toMatchObject([
			{ name: "tries", ref: "vars.tries", json: false },
			{
				name: "plan",
				ref: "vars.plan",
				json: true,
				description: "The steps",
			},
		]);
		expect(scope.nodes.map((node) => node.id)).toEqual([
			"planner",
			"list",
			"read",
			"size",
			"each",
			"sub",
			"pause",
			"use",
		]);
		expect(scope.run.map((field) => field.ref)).toContain("run.branch");
	});

	test("a command has data only when it prints JSON", () => {
		const scope = templateScope(mainFlow(), { flows });
		const fieldsOf = (id: string) =>
			scope.nodes.find((node) => node.id === id)?.fields.map((f) => f.name);
		expect(fieldsOf("list")).not.toContain("data");
		expect(fieldsOf("read")).toContain("data");
	});

	test("the keys of an output schema are suggestions below data", () => {
		const scope = templateScope(mainFlow(), { flows });
		const data = (id: string) =>
			scope.nodes
				.find((node) => node.id === id)
				?.fields.find((field) => field.name === "data");
		expect(data("planner")).toMatchObject({
			name: "data",
			ref: "planner.data",
			json: true,
			keys: [
				{ name: "tasks", ref: "planner.data.tasks", json: true },
				{ name: "title", ref: "planner.data.title", json: false },
			],
		});
		expect(data("size")?.keys?.map((key) => key.ref)).toEqual([
			"size.data.size",
		]);
	});

	test("a Subflow node adds the outputs of the flow it calls, once it is known", () => {
		const sub = (known: ProjectFlowMap | undefined) =>
			templateScope(mainFlow(), { flows: known }).nodes.find(
				(node) => node.id === "sub",
			);
		expect(sub(flows)).toMatchObject({
			id: "sub",
			open: false,
			fields: [
				{ name: "outcome", ref: "sub.outcome", json: false },
				{ name: "ended", ref: "sub.ended", json: false },
				{ name: "end_message", ref: "sub.end_message", json: false },
				{ name: "end_report", ref: "sub.end_report", json: false },
				{ name: "visit", ref: "sub.visit", json: false },
				{
					name: "verdict",
					ref: "sub.verdict",
					json: true,
					output: true,
					description: "What the review found",
				},
			],
		});
		// Not known yet: any field passes until the flows load.
		expect(sub(undefined)?.open).toBe(true);
		expect(errorsOf("echo {{sub.anything}}")).toEqual([]);
	});

	test("a variable's initial value reads the inputs and run only", () => {
		const scope = templateScope(mainFlow(), { flows, initialValue: true });
		expect(scope.vars).toBeNull();
		expect(scope.nodes).toEqual([]);
		expect(scope.inputs.map((input) => input.ref)).toEqual(["topic", "spec"]);
	});
});

describe("calledFlow", () => {
	test("finds the flow a Call node names", () => {
		expect(calledFlow("review", { review })).toBe(review);
	});

	test("is undefined while the flows load, for no name, or a broken or unknown flow", () => {
		expect(calledFlow("review", undefined)).toBeUndefined();
		expect(calledFlow("", { review })).toBeUndefined();
		expect(calledFlow("broken", { broken: null })).toBeUndefined();
		expect(calledFlow("missing", { review })).toBeUndefined();
	});

	test("a flow name that every object has as a property is no flow", () => {
		expect(calledFlow("constructor", { review })).toBeUndefined();
	});
});

describe("the checks accept what the scope lists", () => {
	test("every reference the scope lists passes, in a node's template", () => {
		const refs = refsOf(templateScope(mainFlow(), { flows }));
		const refused = refs.filter(
			(ref) => errorsOf(`echo "{{${ref}}}"`, flows).length > 0,
		);
		expect(refs.length).toBeGreaterThan(30);
		expect(refused).toEqual([]);
	});

	test("a reference the scope does not list fails", () => {
		for (const ref of [
			"list.data",
			"run.nope",
			"topic.deeper",
			"vars.nope",
			"vars.tries.deeper",
			"nobody.outcome",
			"list.nope",
			"list",
		]) {
			expect(errorsOf(`echo "{{${ref}}}"`, flows)).toHaveLength(1);
		}
		expect(errorsOf('echo "{{list.data}}"', flows)[0]).toContain(
			'the command node "list" prints text',
		);
	});

	test("in a variable's initial value, every listed reference passes and a node fails", () => {
		const initialOf = (initial: string) =>
			validateFlow(
				{
					...mainFlow(),
					variables: [
						{ name: "tries", type: "text", initial },
						{ name: "plan", type: "json" },
					],
				},
				{ flows, name: "main" },
			)
				.filter((issue) => issue.severity === "error")
				.map((issue) => issue.message);
		const refs = refsOf(
			templateScope(mainFlow(), { flows, initialValue: true }),
		);
		expect(refs.filter((ref) => initialOf(`{{${ref}}}`).length > 0)).toEqual(
			[],
		);
		expect(initialOf("{{list.outcome}}")).toEqual([
			'The initial value of variable "tries" uses {{list.outcome}}. It can read the inputs and run only: no step ran yet.',
		]);
		expect(initialOf("{{run.nope}}")).toHaveLength(1);
	});
});

describe("shape warnings", () => {
	/** The issues of `flow` about a path its shape lacks, by severity. */
	function shapeIssues(flow: Flow): string[] {
		return validateFlow(flow, { flows, name: "main" })
			.filter((issue) => issue.message.includes("has no field"))
			.map((issue) => `${issue.severity}: ${issue.message}`);
	}

	test("a path below data that the output schema lacks is a warning, with the keys it has", () => {
		expect(
			shapeIssues(mainFlow("echo {{planner.data.taks}} {{size.data.size}}")),
		).toEqual([
			'warning: The command of "use" uses {{planner.data.taks}}, but planner.data has no field "taks". Use one of: tasks, title.',
		]);
	});

	test("a path into text, or a name into a list, is a warning too", () => {
		expect(
			shapeIssues(
				mainFlow("echo {{planner.data.title.first}} {{planner.data.tasks.x}}"),
			),
		).toEqual([
			'warning: The command of "use" uses {{planner.data.title.first}}, but the shape of planner.data.title has no field "first".',
			'warning: The command of "use" uses {{planner.data.tasks.x}}, but the shape of planner.data.tasks has no field "x".',
		]);
	});

	test("a shape that does not say, an input of type json and the keys a command writes for Night Shift never warn", () => {
		expect(
			shapeIssues(
				mainFlow(
					"echo {{planner.data.tasks.0.anything}} {{read.data.x}} {{spec.a.b}} {{sub.verdict.x}} {{vars.plan.x}}",
				),
			),
		).toEqual([]);
		const typed = mainFlow("echo {{read.data.outcome}} {{read.data.scores.n}}");
		const withSchema: Flow = {
			...typed,
			nodes: typed.nodes.map((node) =>
				node.id === "read" && node.type === "command"
					? { ...node, output: { type: "object", properties: {} } }
					: node,
			),
		};
		expect(shapeIssues(withSchema)).toEqual([]);
	});

	test("a command's output schema, a variable's schema and a called flow's output schema give shapes", () => {
		const flow = mainFlow(
			"echo {{read.data.count}} {{read.data.cnt}} {{vars.plan.steps}} {{sub.verdict.ok}}",
		);
		const typed: Flow = {
			...flow,
			variables: [
				{ name: "tries", type: "number" },
				{
					name: "plan",
					type: "json",
					schema: { type: "object", properties: { steps: { type: "array" } } },
				},
			],
			nodes: flow.nodes.map((node) =>
				node.id === "read" && node.type === "command"
					? {
							...node,
							output: {
								type: "object",
								properties: { count: { type: "integer" } },
							},
							outputInferred: true,
						}
					: node,
			),
		};
		const typedReview: Flow = {
			...review,
			outputs: [
				{
					name: "verdict",
					value: "{{look.log_tail}}",
					type: "json",
					schema: { type: "object", properties: { pass: { type: "boolean" } } },
				},
			],
		};
		expect(
			validateFlow(typed, { flows: { ...flows, review: typedReview } })
				.filter((issue) => issue.message.includes("has no field"))
				.map((issue) => issue.message),
		).toEqual([
			'The command of "use" uses {{read.data.cnt}}, but read.data has no field "cnt". Use one of: count.',
			'The command of "use" uses {{sub.verdict.ok}}, but sub.verdict has no field "ok". Use one of: pass.',
		]);
		const read = templateScope(typed, { flows })
			.nodes.find((node) => node.id === "read")
			?.fields.find((field) => field.name === "data");
		expect(read?.keys?.map((key) => key.ref)).toEqual(["read.data.count"]);
	});

	test("the results of a Subflow that runs per element hold the called flow's outputs, with their shapes", () => {
		const typedTask: Flow = {
			...task,
			outputs: [
				{
					name: "summary",
					value: "{{work.log_tail}}",
					type: "json",
					schema: { type: "object", properties: { pass: { type: "boolean" } } },
				},
			],
		};
		const warned = (command: string, known: ProjectFlowMap) =>
			validateFlow(mainFlow(command), { flows: known, name: "main" })
				.filter((issue) => issue.message.includes("has no field"))
				.map((issue) => issue.message);
		const typed = { ...flows, task: typedTask };
		expect(
			warned(
				"echo {{each.results.0.outputs.summary.pass}} {{each.results.0.title}}",
				typed,
			),
		).toEqual([]);
		expect(
			warned(
				"echo {{each.results.0.outputs.sumary}} {{each.results.0.outputs.summary.ok}}",
				typed,
			),
		).toEqual([
			'The command of "use" uses {{each.results.0.outputs.sumary}}, but each.results.0.outputs has no field "sumary". Use one of: summary.',
			'The command of "use" uses {{each.results.0.outputs.summary.ok}}, but each.results.0.outputs.summary has no field "ok". Use one of: pass.',
		]);
		// While the flows load, the results take any path below their outputs.
		expect(warned("echo {{each.results.0.outputs.sumary}}", {})).toEqual([]);
	});

	test("only a json output takes a schema", () => {
		expect(
			validateFlow({
				...review,
				outputs: [
					{
						name: "verdict",
						value: "{{look.log_tail}}",
						type: "text",
						schema: { type: "object" },
					},
				],
			}).map((issue) => issue.message),
		).toContain(
			'The output "verdict" has a schema, but only a json output takes one. Make it json, or remove the schema.',
		);
	});
});
