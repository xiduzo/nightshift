import { describe, expect, test } from "bun:test";
import type { Flow, FlowNode } from "../flow";
import type { ValueNode } from "../nodes";
import { validateFlow } from "./flow";
import type { FlowIssue } from "./issues";

const at = { x: 0, y: 0 };

const output = {
	type: "object",
	required: ["variant"],
	properties: {
		variant: { type: "string", description: "The variant to build" },
		comment: { type: "string" },
	},
};

function ask(extra: Partial<ValueNode> = {}): ValueNode {
	return {
		id: "pick",
		type: "value",
		position: at,
		by: "person",
		prompt: "Which variant for {{issue}}?",
		output,
		choices: { from: "{{designer.data.variants}}", field: "variant" },
		...extra,
	};
}

const designer: FlowNode = {
	id: "designer",
	type: "command",
	position: at,
	command: "make-variants",
	output: "json",
};

function flow(nodes: FlowNode[]): Flow {
	return {
		version: 7,
		inputs: [{ name: "issue", type: "text" }],
		outputs: [],
		start: nodes[0]?.id ?? "",
		nodes,
		edges: nodes.slice(1).map((node, index) => ({
			id: `e${index}`,
			from: nodes[index]?.id ?? "",
			to: node.id,
			outcome: "pass",
		})),
	};
}

const issues = (node: ValueNode, severity: FlowIssue["severity"] = "error") =>
	validateFlow(flow([designer, node]))
		.filter((issue) => issue.severity === severity)
		.map((issue) => issue.message);

describe("a Value made by a person (an Ask, ADR 10)", () => {
	test("an Ask with choices from the run, attachments and a deadline is valid", () => {
		expect(
			issues(
				ask({
					attachments: [
						{ path: "screens/{{issue}}.png", label: "Today" },
						{ url: "https://example.com/preview" },
					],
					deadline: { minutes: 60 },
					default: { variant: "a" },
				}),
			),
		).toEqual([]);
	});

	test("an Ask needs a prompt: the question the person answers", () => {
		expect(issues(ask({ prompt: " " }))).toEqual([
			'Value node "pick" needs a prompt: the question the person answers.',
		]);
	});

	test("an Ask's output schema must describe an object", () => {
		expect(
			issues(ask({ output: { type: "string" }, choices: undefined })),
		).toEqual([
			'The output schema of value node "pick" must describe an object: give it "type": "object" or "properties".',
		]);
	});

	test("an Ask reads no profile, decider or model", () => {
		expect(issues(ask({ decider: "openrouter", model: "x" }))).toEqual([
			'Value node "pick" names a decider and a model, but a person makes it. Only a model reads them. Remove them, or let a model make it.',
		]);
	});

	test("the choices go to a field of the output schema", () => {
		expect(
			issues(ask({ choices: { from: "{{designer.data}}", field: "ghost" } })),
		).toEqual([
			'The choices of Value node "pick" go to the field "ghost", which the output schema does not have. Add it to the output schema, or name another field.',
		]);
	});

	test("the field of the choices is text or a list of text", () => {
		const numbers = {
			type: "object",
			properties: {
				count: { type: "number" },
				tags: { type: "array", items: { type: "string" } },
			},
		};
		expect(
			issues(
				ask({
					output: numbers,
					choices: { from: "{{designer.data}}", field: "count" },
				}),
			),
		).toEqual([
			'The choices of Value node "pick" go to the field "count", which is not text or a list of text. Give it "type": "string", or "type": "array" with string items.',
		]);
		expect(
			issues(
				ask({
					output: numbers,
					choices: { from: "{{designer.data}}", field: "tags" },
				}),
			),
		).toEqual([]);
	});

	test("the choices template reads only known names", () => {
		expect(
			issues(ask({ choices: { from: "{{ghost.data}}", field: "variant" } }))[0],
		).toContain("{{ghost.data}}");
	});

	test("an attachment is one file or one link", () => {
		expect(
			issues(
				ask({
					attachments: [
						{ label: "Nothing" },
						{ path: "a.png", url: "https://example.com" },
					],
				}),
			),
		).toEqual([
			'Attachment 1 of Value node "pick" needs a file path or a link. Give it one of the two.',
			'Attachment 2 of Value node "pick" needs a file path or a link. Give it one of the two.',
		]);
	});

	test("a deadline needs one time and a default", () => {
		expect(issues(ask({ deadline: {} }))).toEqual([
			'The deadline of Value node "pick" needs a time or a number of minutes. Give it one of the two.',
			'Value node "pick" has a deadline but no default. Give it the data it takes when nobody answers.',
		]);
	});

	test("the default must match the output schema", () => {
		expect(
			issues(ask({ deadline: { at: "07:00" }, default: { comment: "late" } })),
		).toEqual([
			'The default of Value node "pick" does not match the output schema: "variant" needs an answer.',
		]);
		expect(
			issues(ask({ deadline: { at: "07:00" }, default: { variant: 3 } })),
		).toEqual([
			'The default of Value node "pick" does not match the output schema: "variant" must be text.',
		]);
	});

	test("a default with no deadline is never taken", () => {
		expect(issues(ask({ default: { variant: "a" } }), "warning")).toContain(
			'Value node "pick" has a default but no deadline, so it never takes the default. Add a deadline, or remove the default.',
		);
	});

	test("only a person reads the choices, attachments, deadline and default", () => {
		expect(
			issues(
				ask({
					by: "rule",
					expression: "{ 'variant': 'a' }",
					prompt: undefined,
					attachments: [{ url: "https://example.com" }],
				}),
			),
		).toEqual([
			'Value node "pick" sets choices, attachments, but only a person reads them. Remove them, or let a person make it.',
		]);
	});

	test("a cascade belongs to a model, not a person", () => {
		expect(issues(ask({ cascade: [{ decider: "openrouter" }] }))[0]).toBe(
			'Value node "pick" has a cascade, but a person makes it. Only a model climbs a cascade. Remove the cascade, or let a model make it.',
		);
	});
});
