import { describe, expect, test } from "bun:test";
import { FLOW_VERSION, type Flow, type FlowInput, flowSchema } from "../flow";
import { flowConfigUse } from "./flow-config-use";

const at = { x: 0, y: 0 };

/** A flow of these nodes, with no edges: the order of the nodes is all that counts here. */
function flowOf(
	nodes: Record<string, unknown>[],
	extra: Partial<Omit<FlowInput, "version" | "nodes">> = {},
): Flow {
	return flowSchema.parse({
		version: FLOW_VERSION,
		start: nodes[0]?.id ?? "a",
		nodes: nodes.map((node) => ({ position: at, ...node })),
		edges: [],
		...extra,
	});
}

const agent = (id: string, fields: Record<string, unknown> = {}) => ({
	id,
	type: "agent",
	prompt: "Do the work",
	harness: "claude-code",
	model: "sonnet",
	permissionMode: "auto",
	...fields,
});

const call = (id: string, flow: string, extra: object = {}) => ({
	id,
	type: "call",
	flow,
	...extra,
});

const mac = (profile: string) => ({ device: "mac", profile });

describe("flowConfigUse: the flow's own nodes", () => {
	test("the connections of Agent and Tool nodes, and the CLI tools of Agent nodes, each once", () => {
		const flow = flowOf([
			agent("plan", { connections: ["tracker"], clis: ["gh", "jq"] }),
			{ id: "file", type: "tool", connection: "tracker", tool: "create" },
			{ id: "post", type: "tool", connection: "chat", tool: "send" },
			agent("check", { clis: ["jq"] }),
		]);
		expect(flowConfigUse(flow)).toEqual({
			connections: ["tracker", "chat"],
			clis: ["gh", "jq"],
			profiles: [],
		});
	});

	test("each tier of a cascade adds its own, and a node's profiles: its own, each tier's and each backup", () => {
		const flow = flowOf([
			agent("fix", {
				harness: undefined,
				model: undefined,
				permissionMode: undefined,
				connections: ["tracker"],
				cascade: [
					{ profile: mac("cheap") },
					{ profile: mac("strong"), clis: ["gh"], connections: ["docs"] },
				],
			}),
			agent("write", {
				harness: undefined,
				model: undefined,
				permissionMode: undefined,
				profile: mac("cheap"),
				fallbacks: [{ device: "host", profile: "cheap" }],
			}),
			{
				id: "sort",
				type: "decision",
				prompt: "Which kind?",
				options: [{ name: "bug" }, { name: "idea" }],
				by: "model",
				profile: mac("jev"),
			},
		]);
		expect(flowConfigUse(flow)).toEqual({
			connections: ["tracker", "docs"],
			clis: ["gh"],
			profiles: [
				mac("cheap"),
				mac("strong"),
				{ device: "host", profile: "cheap" },
				mac("jev"),
			],
		});
	});

	test("a profile name left from format 6 names no profile", () => {
		const flow = flowOf([
			agent("old", {
				harness: undefined,
				model: undefined,
				permissionMode: undefined,
				profile: "fast",
			}),
		]);
		expect(flowConfigUse(flow).profiles).toEqual([]);
	});
});

describe("flowConfigUse: the flows and kits it calls", () => {
	test("a flow of the project, each tier of a Call's cascade, a list call, and a call back that ends the walk", () => {
		const research = flowOf([
			agent("read", { connections: ["search"], clis: ["curl"] }),
			call("again", "main"),
		]);
		const report = flowOf([
			{ id: "post", type: "tool", connection: "chat", tool: "send" },
			{
				id: "rate",
				type: "decision",
				prompt: "Is it good?",
				options: [{ name: "yes" }, { name: "no" }],
				by: "model",
				profile: mac("jev"),
			},
		]);
		const each = flowOf([agent("one", { clis: ["pandoc"] })]);
		const main = flowOf([
			call("look", "research", {
				cascade: [{ flow: "research" }, { flow: "report" }],
			}),
			call("all", "each", {
				each: { source: { kind: "json", value: "[1, 2]" }, as: "item" },
			}),
			call("missing", "gone"),
			call("broken", "broken"),
		]);
		const flows = { main, research, report, each, broken: null };
		expect(flowConfigUse(main, { flows, name: "main" })).toEqual({
			connections: ["search", "chat"],
			clis: ["curl", "pandoc"],
			profiles: [mac("jev")],
		});
		// Without the project's flows, only kits are known: the walk that
		// reaches into a kit is `flowSecrets`'s too, and its tests call one.
		expect(flowConfigUse(main)).toEqual({
			connections: [],
			clis: [],
			profiles: [],
		});
	});
});
