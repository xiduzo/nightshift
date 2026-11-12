import { describe, expect, test } from "bun:test";
import { FLOW_VERSION, type Flow, type FlowInput, flowSchema } from "../flow";
import { dataLinks } from "./reads";

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
