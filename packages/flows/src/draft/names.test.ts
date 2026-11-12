import { describe, expect, test } from "bun:test";
import { FLOW_VERSION, type Flow, flowSchema } from "../flow";
import { validateFlow } from "../validate";
import { renameNode } from "./graph";
import { type NameOwner, nameClash, takenNames, uniqueNodeId } from "./names";
import { renameInput, renameVariable } from "./refs";

const at = { x: 0, y: 0 };

const flow: Flow = flowSchema.parse({
	version: FLOW_VERSION,
	inputs: [{ name: "topic", type: "text" }],
	variables: [{ name: "tries", type: "number" }],
	start: "build",
	nodes: [
		{
			id: "build",
			type: "command",
			position: at,
			command: "echo {{topic}}",
			set: [{ variable: "tries", value: "1" }],
		},
		{ id: "check", type: "command", position: at, command: "true" },
	],
	edges: [{ id: "e1", from: "build", outcome: "pass", to: "check" }],
});

const errors = (draft: Flow) =>
	validateFlow(draft).filter((issue) => issue.severity === "error");
const warnings = (draft: Flow) =>
	validateFlow(draft)
		.filter((issue) => issue.severity === "warning")
		.map((issue) => issue.message);

/** The draft after `owner` takes `name`. */
function renamed(owner: NameOwner, name: string): Flow {
	if ("node" in owner) return renameNode(flow, owner.node, name);
	if ("input" in owner) return renameInput(flow, owner.input, name);
	return renameVariable(flow, owner.variable, name);
}

describe("a name in the flow's one namespace", () => {
	test("run and vars are reserved", () => {
		expect(nameClash(flow, "vars", { node: "check" })).toBe("reserved");
		expect(nameClash(flow, "run", { input: 0 })).toBe("reserved");
	});

	test("node ids, inputs and variables clash with each other", () => {
		expect(nameClash(flow, "build", { node: "check" })).toBe("node");
		expect(nameClash(flow, "topic", { node: "check" })).toBe("input");
		expect(nameClash(flow, "tries", { node: "check" })).toBe("variable");
		expect(nameClash(flow, "check", { variable: 0 })).toBe("node");
	});

	test("the owner keeps its own name", () => {
		expect(nameClash(flow, "check", { node: "check" })).toBeNull();
		expect(nameClash(flow, "topic", { input: 0 })).toBeNull();
		expect(nameClash(flow, "tries", { variable: 0 })).toBeNull();
		expect(nameClash(flow, "review", { node: "check" })).toBeNull();
	});

	const owners: NameOwner[] = [
		{ node: "check" },
		{ input: 0 },
		{ variable: 0 },
	];
	const names = ["vars", "run", "build", "check", "topic", "tries", "review"];

	test("validation refuses a name that clashes, and accepts one that does not", () => {
		for (const owner of owners) {
			for (const name of names) {
				const clash = nameClash(flow, name, owner);
				expect({
					owner,
					name,
					refused: errors(renamed(owner, name)).length > 0,
				}).toEqual({ owner, name, refused: clash !== null });
			}
		}
	});

	// A Since last run rule reads `previous` and `current` as its own
	// values: a node or an input of that name is out of its reach.
	test("a name a rule reads as its own: refused for a node or an input, warned about in a flow", () => {
		for (const name of ["previous", "current"]) {
			expect(nameClash(flow, name, { node: "check" })).toBe("rule");
			expect(nameClash(flow, name, { input: 0 })).toBe("rule");
			expect(errors(renamed({ node: "check" }, name))).toEqual([]);
			expect(warnings(renamed({ node: "check" }, name))).toContain(
				`Since last run rules read "${name}" as their own value, not this node. Give the node another id.`,
			);
			expect(errors(renamed({ input: 0 }, name))).toEqual([]);
			expect(warnings(renamed({ input: 0 }, name))).toContain(
				`Since last run rules read "${name}" as their own value, not this input. Pick another name.`,
			);
		}
	});

	test("a variable may take a rule's own name: a rule reads it as vars.<name>", () => {
		expect(nameClash(flow, "current", { variable: 0 })).toBeNull();
		expect(validateFlow(renamed({ variable: 0 }, "current"))).toEqual([]);
	});

	test("a node or an input that has a rule's own name may keep it", () => {
		const old = renameInput(
			renameNode(flow, "check", "current"),
			0,
			"previous",
		);
		expect(nameClash(old, "current", { node: "current" })).toBeNull();
		expect(nameClash(old, "previous", { input: 0 })).toBeNull();
		expect(nameClash(old, "previous", { node: "current" })).toBe("rule");
	});

	test("a new name is never a rule's own", () => {
		expect(takenNames(flow).has("previous")).toBe(true);
		expect(uniqueNodeId(flow, "current")).toBe("current_2");
	});
});
