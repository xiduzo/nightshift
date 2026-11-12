import { describe, expect, test } from "bun:test";
import { FLOW_VERSION, type Flow, type FlowInput, flowSchema } from "../flow";
import { dataLinks, flowReads, readsOf } from "./reads";

const at = { x: 0, y: 0 };
const flowOf = (input: Omit<FlowInput, "version" | "start" | "edges">): Flow =>
	flowSchema.parse({
		version: FLOW_VERSION,
		start: input.nodes?.[0]?.id ?? "",
		edges: [],
		...input,
	});
const command = (id: string, cmd = "true", extra: object = {}) => ({
	id,
	type: "command" as const,
	position: at,
	command: cmd,
	...extra,
});

/** The dotted lines of the canvas: which node reads which. */
describe("dataLinks", () => {
	test("a Subflow's bindings and the list it runs for each element read nodes", () => {
		const flow = flowOf({
			nodes: [
				command("scout"),
				command("pick"),
				{
					id: "research",
					type: "call",
					position: at,
					flow: "research-topic",
					inputs: {
						topic: "{{scout.data.topic}}",
						depth: "{{scout.data.depth}} and {{scout.data.topic}}",
					},
					each: {
						source: { kind: "json", value: "{{pick.data.items}}" },
						as: "item",
					},
				},
			],
		});
		expect(dataLinks(flow)).toEqual([
			{ from: "pick", to: "research", refs: ["data.items"] },
			{ from: "scout", to: "research", refs: ["data.topic", "data.depth"] },
		]);
	});

	test("rules read nodes, with the keys after each name", () => {
		const flow = flowOf({
			nodes: [
				command("scout"),
				{
					id: "enough",
					type: "decision",
					position: at,
					prompt: "",
					by: "rule",
					options: [
						{ name: "yes", when: "$count(scout.data.items) > 3" },
						{ name: "no" },
					],
				},
				{
					id: "fresh",
					type: "since-last-run",
					position: at,
					value: "{{scout.data.price}}",
					when: "current > previous * 1.1 and enough.outcome = 'yes'",
				},
			],
		});
		expect(dataLinks(flow)).toEqual([
			{ from: "scout", to: "enough", refs: ["data.items"] },
			{ from: "scout", to: "fresh", refs: ["data.price"] },
			{ from: "enough", to: "fresh", refs: ["outcome"] },
		]);
	});

	test("a rule that reads a node through its root ($$) links to it", () => {
		const flow = flowOf({
			nodes: [
				command("scout"),
				command("limits"),
				{
					id: "pick",
					type: "value",
					position: at,
					by: "rule",
					output: { type: "array" },
					expression: "scout.data.items[price < $$.limits.data.max]",
				},
			],
		});
		expect(dataLinks(flow)).toEqual([
			{ from: "scout", to: "pick", refs: ["data.items"] },
			{ from: "limits", to: "pick", refs: ["data.max"] },
		]);
	});

	test("the values and the expressions of variable writes read nodes, but a node's own id does not link", () => {
		const flow = flowOf({
			variables: [
				{ name: "seen", type: "text" },
				{ name: "tries", type: "number", initial: "0" },
			],
			nodes: [
				command("scout"),
				command("count", "true", {
					set: [
						{ variable: "seen", value: "{{scout.log_tail}}" },
						{ variable: "tries", expression: "count.exit_code + vars.tries" },
					],
				}),
			],
		});
		expect(dataLinks(flow)).toEqual([
			{ from: "scout", to: "count", refs: ["log_tail"] },
		]);
	});

	test("an End's report, a Web request's headers and an Agent's check read nodes", () => {
		const flow = flowOf({
			nodes: [
				command("scout"),
				{
					id: "fetch",
					type: "web-request",
					position: at,
					method: "GET",
					url: "https://example.com/items",
					headers: { "If-None-Match": "{{scout.data.etag}}" },
				},
				{
					id: "write",
					type: "agent",
					position: at,
					prompt: "Write it up.",
					harness: "claude-code",
					model: "sonnet",
					permissionMode: "acceptEdits",
					session: "resume",
					check: 'test -n "{{fetch.body}}"',
				},
				{
					id: "done",
					type: "end",
					position: at,
					status: "done",
					report: {
						kind: "text",
						text: "# Items\n\n{{fetch.body}}\n\n{{write.output}}",
					},
				},
			],
		});
		expect(dataLinks(flow)).toEqual([
			{ from: "scout", to: "fetch", refs: ["data.etag"] },
			{ from: "fetch", to: "write", refs: ["body"] },
			{ from: "fetch", to: "done", refs: ["body"] },
			{ from: "write", to: "done", refs: ["output"] },
		]);
	});

	test("inputs, variables, run and names the flow does not have are left out", () => {
		const flow = flowOf({
			inputs: [{ name: "topic" }],
			variables: [{ name: "notes", type: "text" }],
			nodes: [
				command("scout"),
				command(
					"say",
					'echo "{{topic}} {{vars.notes}} {{run.flow}} {{ghost.data}} {{say.log_tail}} {{scout}}"',
				),
			],
		});
		// `{{scout}}` reads the node without a field: a link with nothing to name.
		expect(dataLinks(flow)).toEqual([{ from: "scout", to: "say", refs: [] }]);
	});
});

describe("flowReads and readsOf", () => {
	const flow = flowOf({
		inputs: [{ name: "topic" }],
		outputs: [{ name: "summary", value: "{{pick.data.title}}" }],
		variables: [{ name: "seen", type: "text", initial: "{{topic}}" }],
		nodes: [
			command("scout", 'echo "{{topic}}" # {{label.data}}', {
				label: "Read {{ghost.data}}",
			}),
			{
				id: "pick",
				type: "value",
				position: at,
				by: "model",
				prompt: "Pick one of {{scout.data.items}}.",
				output: { type: "object" },
				// A person picks from choices: a Value a model makes does not use them.
				choices: { from: "{{stale.data.items}}", field: "pick" },
				set: [{ variable: "seen", expression: "pick.data.id & $$.vars.seen" }],
			},
		],
	});

	test("flowReads: the texts each node uses, then the outputs and the initial values", () => {
		expect(
			flowReads(flow).map(({ reader, name, path, rule, self }) => [
				Object.values(reader)[0],
				[name, ...path].join("."),
				rule ? "rule" : "template",
				self,
			]),
		).toEqual([
			["scout", "topic", "template", false],
			["scout", "label.data", "template", false],
			["pick", "scout.data.items", "template", false],
			["pick", "pick.data.id", "rule", true],
			["pick", "vars.seen", "rule", true],
			["summary", "pick.data.title", "template", false],
			["seen", "topic", "template", false],
		]);
	});

	test("readsOf: every text of the node, a field it does not use too, templates first", () => {
		const [, pick] = flow.nodes;
		expect(
			(pick ? readsOf(pick) : []).map(({ name, path }) =>
				[name, ...path].join("."),
			),
		).toEqual([
			"scout.data.items",
			"stale.data.items",
			"pick.data.id",
			"vars.seen",
		]);
	});
});
