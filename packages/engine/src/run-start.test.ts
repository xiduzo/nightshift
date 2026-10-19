import { describe, expect, test } from "bun:test";
import type { AgentHarness, Decider } from "@nightshift/agents/types";
import type { Flow, FlowNode } from "@nightshift/flows";

import {
	checkersHaveDecider,
	cliToolsDefined,
	cliToolsInstalled,
	connectionsExist,
	type DaemonHas,
	harnessesAdded,
	modelDecisionsHaveDecider,
	modelValuesHaveDecider,
	quickRunTitle,
	REQUIREMENTS,
	refusalOf,
} from "./run-start";

/**
 * The requirement checks of run start, each with fake daemon inventory.
 * The whole start path (worktree, run row, `RunStarted`) is covered by
 * engine.test.ts through the public interface; these pin the message each
 * requirement refuses with, so a later move onto node-kind descriptors has
 * a net under it.
 */

const node = (fields: Record<string, unknown>): FlowNode =>
	fields as unknown as FlowNode;

const agent = (id: string, fields: Record<string, unknown> = {}) =>
	node({ id, type: "agent", prompt: "work", ...fields });

/** A daemon that has everything, unless a test takes something away. */
function has(overrides: Partial<DaemonHas> = {}): DaemonHas {
	return {
		harnessFor: () => ({}) as AgentHarness,
		connectionNames: () => new Set(["github"]),
		cliNames: () => new Set(["gh"]),
		findCli: () => "/usr/bin/tool",
		decider: {
			decide: async () => ({}) as never,
			value: async () => ({}) as never,
		},
		...overrides,
	};
}

describe("REQUIREMENTS", () => {
	test("lists every requirement once, in the order a person sees them", () => {
		expect(REQUIREMENTS).toEqual([
			connectionsExist,
			cliToolsDefined,
			cliToolsInstalled,
			harnessesAdded,
			modelDecisionsHaveDecider,
			checkersHaveDecider,
			modelValuesHaveDecider,
		]);
	});

	test("a daemon that has everything refuses nothing", () => {
		const nodes = [
			agent("a", {
				harness: "claude-code",
				connections: ["github"],
				clis: ["gh"],
				nodeClis: ["jq"],
				checker: { prompt: "ok?" },
			}),
			node({ id: "t", type: "tool", connection: "github" }),
			node({ id: "d", type: "decision", by: "model" }),
			node({ id: "v", type: "value", by: "model" }),
		];
		expect(refusalOf(nodes, has())).toBeNull();
	});

	test("refusalOf answers with the first failing requirement", () => {
		const nodes = [agent("a", { connections: ["jira"], clis: ["acli"] })];
		const daemon = has({
			connectionNames: () => new Set(),
			cliNames: () => new Set(),
		});
		expect(refusalOf(nodes, daemon)).toBe(connectionsExist(nodes, daemon));
	});
});

describe("connectionsExist", () => {
	test("names the connection and every node that uses it, Agent and Tool alike", () => {
		const nodes = [
			agent("a", { connections: ["jira"] }),
			node({ id: "t", type: "tool", connection: "jira" }),
			node({ id: "t2", type: "tool", connection: "github" }),
		];
		expect(connectionsExist(nodes, has())).toBe(
			'The flow uses the connection "jira" (a, t), but no connection has that name. Add it under Agents → Tools.',
		);
	});
});

describe("cliToolsDefined", () => {
	test("refuses a CLI tool no definition has; a node's own CLI tools need none", () => {
		const nodes = [agent("a", { clis: ["acli"], nodeClis: ["jq"] })];
		expect(cliToolsDefined(nodes, has())).toBe(
			'The flow uses the CLI tool "acli" (a), but no CLI tool has that name. Add it under Agents → Tools.',
		);
	});
});

describe("cliToolsInstalled", () => {
	test("refuses once per tool this computer does not have, defined or the node's own", () => {
		const nodes = [
			agent("a", { clis: ["gh"], nodeClis: ["jq"] }),
			agent("b", { nodeClis: ["jq"] }),
		];
		const daemon = has({ findCli: (name) => (name === "gh" ? "/gh" : null) });
		expect(cliToolsInstalled(nodes, daemon)).toBe(
			'The flow uses the CLI tool "jq", but this computer does not have it. Install jq, or take it off the flow.',
		);
	});
});

describe("harnessesAdded", () => {
	test("counts the Agent nodes on a harness that is not added", () => {
		const nodes = [
			agent("a", { harness: "codex" }),
			agent("b", { harness: "codex" }),
			agent("c"),
		];
		expect(harnessesAdded(nodes, has({ harnessFor: () => undefined }))).toBe(
			"The flow has Agent nodes on Codex (a, b), but no Codex harness is added. Add it under Agents.",
		);
		expect(
			harnessesAdded(nodes.slice(0, 1), has({ harnessFor: () => undefined })),
		).toBe(
			"The flow has an Agent node on Codex (a), but no Codex harness is added. Add it under Agents.",
		);
	});
});

describe("the decider requirements", () => {
	const noDecider = has({ decider: undefined });
	const textless: Decider = { decide: async () => ({}) as never };

	test("a Decision decided by a model needs a decider", () => {
		const nodes = [node({ id: "d", type: "decision", by: "model" })];
		expect(modelDecisionsHaveDecider(nodes, noDecider)).toBe(
			"The flow has a Decision node decided by a model, but no decider is configured.",
		);
		expect(
			modelDecisionsHaveDecider(nodes, has({ decider: textless })),
		).toBeNull();
		expect(
			modelDecisionsHaveDecider(
				[node({ id: "d", type: "decision", by: "person" })],
				noDecider,
			),
		).toBeNull();
	});

	test("an Agent node with a checker needs a decider", () => {
		const nodes = [agent("a", { checker: { prompt: "done?" } })];
		expect(checkersHaveDecider(nodes, noDecider)).toBe(
			"The flow has an Agent node with a checker, but no decider is configured.",
		);
		expect(checkersHaveDecider([agent("a")], noDecider)).toBeNull();
	});

	test("a Value made by a model needs a decider that makes values", () => {
		const nodes = [node({ id: "v", type: "value", by: "model" })];
		expect(modelValuesHaveDecider(nodes, noDecider)).toBe(
			"The flow has a Value node made by a model, but no decider is configured.",
		);
		expect(modelValuesHaveDecider(nodes, has({ decider: textless }))).toBe(
			"The flow has a Value node made by a model, but no decider is configured.",
		);
		expect(modelValuesHaveDecider(nodes, has())).toBeNull();
	});
});

describe("quickRunTitle", () => {
	const flow = (nodes: FlowNode[]): Flow =>
		({
			version: 2,
			start: nodes[0]?.id ?? "a",
			nodes,
			edges: [],
		}) as unknown as Flow;

	test("is the first Agent prompt, whitespace folded", () => {
		expect(
			quickRunTitle(flow([agent("a", { prompt: "  fix\n the   bug " })])),
		).toBe("fix the bug");
	});

	test("falls back when no Agent node has a prompt", () => {
		expect(quickRunTitle(flow([node({ id: "c", type: "command" })]))).toBe(
			"Quick run",
		);
	});

	test("cuts a long prompt at 80 characters with an ellipsis", () => {
		const title = quickRunTitle(
			flow([agent("a", { prompt: "x".repeat(100) })]),
		);
		expect(title).toHaveLength(80);
		expect(title.endsWith("…")).toBe(true);
	});
});
