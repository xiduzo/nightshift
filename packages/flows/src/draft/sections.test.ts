import { describe, expect, test } from "bun:test";
import { type Flow, flowSchema } from "../document";
import { removeNode, renameNode } from "./graph";
import { addSection, removeSection, updateSection } from "./sections";

const command = (id: string) => ({
	id,
	type: "command" as const,
	position: { x: 0, y: 0 },
	command: "true",
});

/** a → b → c → d. */
const chain: Flow = flowSchema.parse({
	version: 5,
	start: "a",
	nodes: ["a", "b", "c", "d"].map(command),
	edges: [
		{ id: "ab", from: "a", outcome: "pass", to: "b" },
		{ id: "bc", from: "b", outcome: "pass", to: "c" },
		{ id: "cd", from: "c", outcome: "pass", to: "d" },
	],
});

describe("addSection", () => {
	test("adds a Section with an id from its label and its nodes in flow order", () => {
		const added = addSection(chain, ["c", "b"], {
			label: "Code review",
			color: "violet",
		});
		if (!added.ok) throw new Error("expected a Section");
		expect(added.id).toBe("code-review");
		expect(added.flow.sections).toEqual([
			{
				id: "code-review",
				label: "Code review",
				color: "violet",
				nodes: ["b", "c"],
			},
		]);
	});

	test("a second Section with the same label gets a free id; no label: Section", () => {
		const first = addSection(chain, ["a"]);
		if (!first.ok) throw new Error("expected a Section");
		expect(first.flow.sections?.[0]).toEqual({
			id: "section",
			label: "Section",
			nodes: ["a"],
		});
		const second = addSection(first.flow, ["c", "d"]);
		if (!second.ok) throw new Error("expected a Section");
		expect(second.id).toBe("section-2");
	});

	test("refuses nodes that cannot form a Section, and changes nothing", () => {
		expect(addSection(chain, ["a", "c"])).toEqual({
			ok: false,
			problems: [
				{ code: "not-connected", parts: [["a"], ["c"]] },
				{ code: "several-entries", entries: ["a", "c"] },
			],
		});
	});
});

describe("updateSection and removeSection", () => {
	const withTwo: Flow = {
		...chain,
		sections: [
			{ id: "front", label: "Front", nodes: ["a", "b"] },
			{ id: "back", label: "Back", nodes: ["c", "d"] },
		],
	};

	test("updateSection changes only that Section", () => {
		const next = updateSection(withTwo, "back", (section) => ({
			...section,
			label: "Ship",
			description: "Ships it.",
		}));
		expect(next.sections).toEqual([
			{ id: "front", label: "Front", nodes: ["a", "b"] },
			{
				id: "back",
				label: "Ship",
				description: "Ships it.",
				nodes: ["c", "d"],
			},
		]);
		expect(updateSection(chain, "back", (s) => s)).toBe(chain);
	});

	test("removeSection keeps the nodes; the last one drops the field", () => {
		const one = removeSection(withTwo, "front");
		expect(one.sections?.map((s) => s.id)).toEqual(["back"]);
		expect(one.nodes).toEqual(withTwo.nodes);
		const none = removeSection(one, "back");
		expect("sections" in none).toBe(false);
	});
});

describe("Sections follow node edits", () => {
	const sectioned: Flow = {
		...chain,
		sections: [
			{ id: "front", label: "Front", nodes: ["a"] },
			{ id: "back", label: "Back", nodes: ["b", "c", "d"] },
		],
	};

	test("removeNode takes the node out of its Section", () => {
		expect(removeNode(sectioned, "c").sections).toEqual([
			{ id: "front", label: "Front", nodes: ["a"] },
			{ id: "back", label: "Back", nodes: ["b", "d"] },
		]);
	});

	test("removeNode drops a Section with no nodes left, and the field with the last", () => {
		expect(removeNode(sectioned, "a").sections).toEqual([
			{ id: "back", label: "Back", nodes: ["b", "c", "d"] },
		]);
		const front: Flow = {
			...chain,
			sections: [sectioned.sections?.[0]].filter((s) => s !== undefined),
		};
		expect("sections" in removeNode(front, "a")).toBe(false);
	});

	test("renameNode renames the node in its Section", () => {
		expect(renameNode(sectioned, "c", "check").sections?.[1]?.nodes).toEqual([
			"b",
			"check",
			"d",
		]);
	});

	test("a flow without Sections stays without", () => {
		expect("sections" in removeNode(chain, "b")).toBe(false);
		expect("sections" in renameNode(chain, "b", "bee")).toBe(false);
	});
});
