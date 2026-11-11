import { describe, expect, test } from "bun:test";
import { HARNESS_LABELS } from "@nightshift/agents/harness-facts";
import { defaultDeciderModel } from "@nightshift/agents/testing";
import type { AgentHarness, Decider } from "@nightshift/agents/types";
import {
	type AgentNode,
	type DecisionNode,
	FLOW_VERSION,
	type FlowNode,
	type ValueNode,
} from "@nightshift/flows";
import type { Capabilities } from "../device/types";
import { AGENT, cliToolsInstalled, harnessesAdded } from "../graph/nodes/agent";
import { DECISION, modelDecisionsHaveDecider } from "../graph/nodes/decision";
import { modelValuesHaveDecider, VALUE } from "../graph/nodes/value";
import {
	cliToolsOf,
	connectionsOf,
	type TestDeviceDeps,
	testDevice,
} from "../testing/test-support";
import {
	connectionsExist,
	REQUIREMENTS,
	readsTheFlow,
	refusalOf,
	unfit,
} from "./fit";

/**
 * The fit check of Placement: the requirements, each over a test Device's
 * capabilities, and `unfit`, the one rule the plan and a step's move ask.
 * The whole start path (worktree, run row, `RunStarted`) is covered by
 * engine.test.ts through the public interface; these pin the message each
 * requirement refuses with. A kind's own requirements live on its
 * descriptor (`NodeKind.requirements`) and get that kind's nodes only;
 * `REQUIREMENTS` lists them over every node.
 */

const node = (fields: Record<string, unknown>): FlowNode =>
	fields as unknown as FlowNode;

const agent = (id: string, fields: Record<string, unknown> = {}) =>
	node({ id, type: "agent", prompt: "work", ...fields }) as AgentNode;
const decision = (id: string, by: DecisionNode["by"]) =>
	node({ id, type: "decision", by }) as DecisionNode;
const value = (id: string, by: ValueNode["by"]) =>
	node({ id, type: "value", by }) as ValueNode;

/** What a Device has that has everything, unless a test takes something away. */
function has(overrides: Partial<TestDeviceDeps> = {}): Promise<Capabilities> {
	const harness = {} as AgentHarness;
	return testDevice({
		harnesses: Object.fromEntries(
			Object.keys(HARNESS_LABELS).map((name) => [name, harness]),
		),
		connections: connectionsOf({ names: ["github"] }),
		cliTools: cliToolsOf(["gh"]),
		which: () => "/usr/bin/tool",
		decider: {
			defaultModel: defaultDeciderModel,
			decide: async () => ({}) as never,
			value: async () => ({}) as never,
		},
		...overrides,
	}).capabilities({ programs: ["gh", "acli", "jq"] });
}

describe("REQUIREMENTS", () => {
	test("lists the flow format and the shared connections check, then every kind's own, once each", async () => {
		expect(REQUIREMENTS[0]).toBe(readsTheFlow);
		expect(REQUIREMENTS[1]).toBe(connectionsExist);
		// The Agent's two, the model Decision's, the model Value's, a Wait for
		// a URL's and the Web request's.
		expect(REQUIREMENTS).toHaveLength(8);
		expect(AGENT.requirements).toEqual([cliToolsInstalled, harnessesAdded]);
		expect(DECISION.requirements).toEqual([modelDecisionsHaveDecider]);
		expect(VALUE.requirements).toEqual([modelValuesHaveDecider]);
	});

	test("a Device of an older Night Shift takes no step of this build's flows", async () => {
		const older = { ...(await has()), elsewhere: "nas" };
		delete older.flowVersion;
		expect(refusalOf([decision("d", "rule")], older)).toBe(
			"nas runs an older version of Night Shift. Update Night Shift on nas.",
		);
		expect(
			refusalOf([decision("d", "rule")], {
				...older,
				flowVersion: FLOW_VERSION,
			}),
		).toBeNull();
	});

	test("a kind's requirement sees its own nodes only", async () => {
		// A Value made by a model fails its check, but a Decision's check must
		// not answer for it: the first refusal is the Value's.
		const nodes = [decision("d", "rule"), value("v", "model")];
		expect(refusalOf(nodes, await has({ decider: undefined }))).toBe(
			"The flow has a Value node made by a model, but no decider is configured.",
		);
	});

	test("a daemon that has everything refuses nothing", async () => {
		const nodes = [
			agent("a", {
				harness: "claude-code",
				connections: ["github"],
				clis: ["gh", "jq"],
			}),
			node({ id: "t", type: "tool", connection: "github" }),
			decision("d", "model"),
			value("v", "model"),
		];
		expect(refusalOf(nodes, await has())).toBeNull();
	});

	test("refusalOf answers with the first failing requirement", async () => {
		const nodes = [agent("a", { connections: ["jira"], clis: ["acli"] })];
		const daemon = await has({
			connections: connectionsOf(),
			cliTools: cliToolsOf([]),
		});
		expect(refusalOf(nodes, daemon)).toBe(connectionsExist(nodes, daemon));
	});
});

describe("unfit: the one fit check", () => {
	const command = node({ id: "c", type: "command", command: "true" });
	const worker = { name: "Laptop", hasClone: true };

	test("an offline Device is unfit before anything is asked of it", async () => {
		let asked = 0;
		const why = await unfit({ ...worker, offline: true }, [command], () => {
			asked++;
			return has();
		});
		expect(why).toBe("Laptop is offline");
		expect(asked).toBe(0);
	});

	test("a Device without the project is unfit for a step that works in the worktree, not for one that does not", async () => {
		const none = { name: "Laptop", hasClone: false };
		expect(await unfit(none, [command], has)).toBe(
			"Laptop does not have this project",
		);
		expect(await unfit(none, [decision("d", "model")], has)).toBeNull();
	});

	test("another Person's Device checks its Offers itself", async () => {
		let asked = 0;
		const why = await unfit({ ...worker, offered: {} }, [command], () => {
			asked++;
			return has({ decider: undefined });
		});
		expect(why).toBeNull();
		expect(asked).toBe(0);
	});

	test("a Device that cannot be reached, or lacks what the step needs, says so with its name", async () => {
		expect(await unfit(worker, [command], async () => null)).toBe(
			"Laptop cannot be reached",
		);
		expect(
			await unfit(worker, [decision("d", "model")], () =>
				has({ decider: undefined }),
			),
		).toBe(
			"Laptop: The flow has a Decision node decided by a model, but no decider is configured.",
		);
		expect(await unfit(worker, [decision("d", "model")], has)).toBeNull();
	});
});

describe("connectionsExist", () => {
	test("names the connection and every node that uses it, Agent and Tool alike", async () => {
		const nodes = [
			agent("a", { connections: ["jira"] }),
			node({ id: "t", type: "tool", connection: "jira" }),
			node({ id: "t2", type: "tool", connection: "github" }),
		];
		expect(connectionsExist(nodes, await has())).toBe(
			'The flow uses the connection "jira" (a, t), but no connection has that name. Add it under Agents → Tools.',
		);
	});
});

describe("cliToolsInstalled", () => {
	test("refuses once per tool this computer does not have, defined or not", async () => {
		const nodes = [
			agent("a", { clis: ["gh", "jq"] }),
			agent("b", { clis: ["jq"] }),
		];
		const daemon = await has({
			which: (name) => (name === "gh" ? "/gh" : null),
		});
		expect(cliToolsInstalled(nodes, daemon)).toBe(
			'The flow uses the CLI tool "jq", but this computer does not have it. Install jq, or remove it from the flow.',
		);
	});
});

describe("harnessesAdded", () => {
	test("counts the Agent nodes on a harness that is not added", async () => {
		const nodes = [
			agent("a", { harness: "codex" }),
			agent("b", { harness: "codex" }),
			agent("c"),
		];
		expect(harnessesAdded(nodes, await has({ harnesses: {} }))).toBe(
			"The flow has Agent nodes on Codex (a, b), but no Codex harness is added. Add it under Agents.",
		);
		expect(
			harnessesAdded(nodes.slice(0, 1), await has({ harnesses: {} })),
		).toBe(
			"The flow has an Agent node on Codex (a), but no Codex harness is added. Add it under Agents.",
		);
	});
});

describe("the decider requirements", () => {
	const noDecider = () => has({ decider: undefined });
	const textless: Decider = {
		defaultModel: defaultDeciderModel,
		decide: async () => ({}) as never,
	};

	test("a Decision decided by a model needs a decider", async () => {
		const nodes = [decision("d", "model")];
		expect(modelDecisionsHaveDecider(nodes, await noDecider())).toBe(
			"The flow has a Decision node decided by a model, but no decider is configured.",
		);
		expect(
			modelDecisionsHaveDecider(nodes, await has({ decider: textless })),
		).toBeNull();
		expect(
			modelDecisionsHaveDecider([decision("d", "person")], await noDecider()),
		).toBeNull();
	});

	test("a Value made by a model needs a decider that makes values", async () => {
		const nodes = [value("v", "model")];
		expect(modelValuesHaveDecider(nodes, await noDecider())).toBe(
			"The flow has a Value node made by a model, but no decider is configured.",
		);
		expect(
			modelValuesHaveDecider(nodes, await has({ decider: textless })),
		).toBe(
			"The flow has a Value node made by a model, but no decider is configured.",
		);
		expect(modelValuesHaveDecider(nodes, await has())).toBeNull();
	});
});
