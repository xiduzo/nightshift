import { describe, expect, test } from "bun:test";
import {
	addNode,
	copyNodes,
	FLOW_VERSION,
	type Flow,
	moveNodes,
	pasteNodes,
	removeNode,
	renameNode,
	sectionOf,
	updateNode,
} from "@nightshift/flows";
import { commandNode } from "@nightshift/flows/testing";
import { createEditingSession } from "./editing-session";

const flow: Flow = {
	version: FLOW_VERSION,
	inputs: [],
	outputs: [],
	start: "a",
	nodes: ["a", "b"].map((id) => commandNode(id, { x: 0, y: 0 })),
	edges: [{ id: "a-pass-b", from: "a", outcome: "pass", to: "b" }],
};

/** `flow` with node `a` at x. */
const movedTo = (x: number) => (draft: Flow) =>
	moveNodes(draft, new Map([["a", { x, y: 0 }]]));

/** `flow` with the command of node `a` changed. */
const typed = (command: string) => (draft: Flow) =>
	updateNode(draft, "a", (node) =>
		node.type === "command" ? { ...node, command } : node,
	);

/** A session on `flow` with a clock you set. */
function sessionOn(start: Flow = flow, { saved = true } = {}) {
	const clock = { at: 0 };
	const session = createEditingSession(start, {
		saved,
		now: () => clock.at,
	});
	return { session, clock };
}

describe("the editing session: history", () => {
	test("each edit is one step that undo and redo walk", () => {
		const { session } = sessionOn();
		session.edit(movedTo(10));
		session.edit(movedTo(20));
		expect(session.get()).toMatchObject({ canUndo: true, canRedo: false });

		expect(session.undo()).toBe(true);
		expect(session.get().draft).toEqual(movedTo(10)(flow));
		expect(session.undo()).toBe(true);
		expect(session.get().draft).toBe(flow);
		expect(session.get()).toMatchObject({ canUndo: false, canRedo: true });
		expect(session.undo()).toBe(false);

		expect(session.redo()).toBe(true);
		expect(session.get().draft).toEqual(movedTo(10)(flow));
	});

	test("a new edit drops the steps Redo had", () => {
		const { session } = sessionOn();
		session.edit(movedTo(10));
		session.undo();
		session.edit(movedTo(30));
		expect(session.get().canRedo).toBe(false);
		expect(session.redo()).toBe(false);
	});

	test("the revision counts the undos and redos, not the edits", () => {
		const { session } = sessionOn();
		session.edit(movedTo(10));
		expect(session.get().revision).toBe(0);
		session.undo();
		session.redo();
		expect(session.get().revision).toBe(2);
		session.undo();
		session.undo();
		expect(session.get().revision).toBe(3);
	});

	test("edits of one gesture merge into one step within the pause", () => {
		const { session, clock } = sessionOn();
		session.edit(typed("e"), "node:a");
		clock.at = 400;
		session.edit(typed("ec"), "node:a");
		clock.at = 800;
		session.edit(typed("ech"), "node:a");
		session.undo();
		expect(session.get().draft).toBe(flow);
	});

	test("the same gesture is a new step after a pause, and after an undo", () => {
		const { session, clock } = sessionOn();
		session.edit(typed("e"), "node:a");
		clock.at = 2000;
		session.edit(typed("ec"), "node:a");
		session.undo();
		expect(session.get().draft).toEqual(typed("e")(flow));

		clock.at = 2100;
		session.edit(typed("ex"), "node:a");
		session.undo();
		expect(session.get().draft).toEqual(typed("e")(flow));
	});

	test("an edit to an equal flow is no step", () => {
		const { session } = sessionOn();
		session.edit(movedTo(0));
		expect(session.get().canUndo).toBe(false);
	});

	test("an edit takes the draft as it is now", () => {
		const { session } = sessionOn();
		session.edit(movedTo(10));
		session.edit((draft) => typed("x")(draft));
		expect(session.get().draft).toEqual(typed("x")(movedTo(10)(flow)));
	});
});

describe("the editing session: saved and dirty", () => {
	test("a flow from disk starts clean, an edit makes it dirty, a save clean", () => {
		const { session } = sessionOn();
		expect(session.get()).toMatchObject({ dirty: false, everSaved: true });
		session.edit(movedTo(10));
		expect(session.get().dirty).toBe(true);
		session.saved(session.get().draft);
		expect(session.get().dirty).toBe(false);
	});

	test("undo back to the saved draft is clean, by what the flow holds", () => {
		const { session } = sessionOn();
		session.edit(movedTo(10));
		session.saved(movedTo(10)(flow));
		session.edit(movedTo(20));
		expect(session.get().dirty).toBe(true);
		session.undo();
		expect(session.get().dirty).toBe(false);
		session.undo();
		expect(session.get().dirty).toBe(true);
	});

	test("a draft not on disk yet is dirty and never saved, until a save", () => {
		const { session } = sessionOn(flow, { saved: false });
		expect(session.get()).toMatchObject({ dirty: true, everSaved: false });
		session.saved(flow);
		expect(session.get()).toMatchObject({ dirty: false, everSaved: true });
	});

	test("a save of an older draft leaves the edits since unsaved", () => {
		const { session } = sessionOn();
		session.edit(movedTo(10));
		const snapshot = session.get().draft;
		session.edit(movedTo(20));
		session.saved(snapshot);
		expect(session.get().dirty).toBe(true);
	});

	test("an edit saved at once is clean before any render", () => {
		// A new called flow: the node points at it, this flow is saved, and
		// the editor leaves for it without asking.
		const { session } = sessionOn();
		const next = typed("called")(flow);
		session.edit(next);
		session.saved(next);
		expect(session.get().dirty).toBe(false);
	});

	test("a restored revision is saved, and Undo goes back to the draft before", () => {
		const { session } = sessionOn();
		session.edit(movedTo(10));
		const revision = typed("old")(flow);
		session.edit(revision);
		session.saved(revision);
		expect(session.get().dirty).toBe(false);
		session.undo();
		expect(session.get().draft).toEqual(movedTo(10)(flow));
		expect(session.get().dirty).toBe(true);
	});
});

describe("the editing session as a store", () => {
	test("the state is the same object until a change", () => {
		const { session } = sessionOn();
		const before = session.get();
		expect(session.get()).toBe(before);
		session.undo();
		session.redo();
		session.edit(flow);
		session.saved(flow);
		expect(session.get()).toBe(before);
		session.edit(movedTo(10));
		expect(session.get()).not.toBe(before);
	});

	test("a listener hears each change until it stops", () => {
		const { session } = sessionOn();
		let heard = 0;
		const stop = session.subscribe(() => {
			heard += 1;
		});
		session.edit(movedTo(10));
		session.undo();
		session.undo();
		expect(heard).toBe(2);
		stop();
		session.redo();
		expect(heard).toBe(2);
	});
});

/**
 * Nodes a and b in the Section one, c in two, d in none. The Section
 * outer holds e and the Section inner, which holds f.
 */
const sectioned: Flow = {
	...flow,
	nodes: ["a", "b", "c", "d", "e", "f"].map((id) =>
		commandNode(id, { x: 0, y: 0 }),
	),
	edges: [
		{ id: "a-pass-b", from: "a", outcome: "pass", to: "b" },
		{ id: "b-pass-d", from: "b", outcome: "pass", to: "d" },
	],
	sections: [
		{ id: "one", label: "One", nodes: ["a", "b"] },
		{ id: "two", label: "Two", nodes: ["c"] },
		{ id: "outer", label: "Outer", nodes: ["e"], sections: ["inner"] },
		{ id: "inner", label: "Inner", nodes: ["f"] },
	],
};

/** The draft with a new node, and its id. */
const withNode = (draft: Flow) => addNode(draft, "command", { x: 0, y: 0 });

describe("the editing session: a node joins the open Section", () => {
	test("an added node joins the open Section, in the same step", () => {
		const { session } = sessionOn(sectioned);
		session.openSection("one");
		const { flow: next, id } = withNode(session.get().draft);
		session.add(next);
		expect(sectionOf(session.get().draft, id)?.id).toBe("one");
		session.undo();
		expect(session.get().draft).toBe(sectioned);
	});

	test("an edit that adds a node leaves it in no Section", () => {
		// The inspector, the chat and Suggest change the whole flow.
		const { session } = sessionOn(sectioned);
		session.openSection("one");
		const { flow: next, id } = withNode(session.get().draft);
		session.edit(next);
		expect(sectionOf(session.get().draft, id)).toBeUndefined();
	});

	test("with no Section open, or one the draft lost, an added node stays out", () => {
		const { session } = sessionOn(sectioned);
		const first = withNode(session.get().draft);
		session.add(first.flow);
		expect(sectionOf(session.get().draft, first.id)).toBeUndefined();

		session.openSection("gone");
		const second = withNode(session.get().draft);
		session.add(second.flow);
		expect(sectionOf(session.get().draft, second.id)).toBeUndefined();
	});

	test("a pasted Section joins the open Section with its nodes", () => {
		const { session } = sessionOn(sectioned);
		const clip = copyNodes(sectioned, ["c"]);
		if (!clip) throw new Error("expected a clip");
		session.openSection("one");
		session.add(pasteNodes(session.get().draft, clip).flow);
		const sections = session.get().draft.sections ?? [];
		const one = sections.find((section) => section.id === "one");
		const pasted = one?.sections?.[0];
		expect(one?.nodes).toEqual(["a", "b"]);
		expect(pasted).toBeDefined();
		expect(sections.find((section) => section.id === pasted)?.nodes).toEqual([
			"c_2",
		]);
	});
});

describe("the editing session: the selection", () => {
	test("select takes a selection, or a change of the one there is", () => {
		const { session } = sessionOn(sectioned);
		session.select({ kind: "node", id: "a" });
		session.select((current) =>
			current?.kind === "node"
				? { kind: "nodes", ids: [current.id, "b"] }
				: null,
		);
		expect(session.get().selection).toEqual({
			kind: "nodes",
			ids: ["a", "b"],
		});
	});

	test("undo drops a selection the draft lost, and keeps one it still has", () => {
		const { session } = sessionOn(sectioned);
		const { flow: next, id } = withNode(sectioned);
		session.add(next);
		session.select({ kind: "node", id });
		session.undo();
		expect(session.get().selection).toBeNull();

		const kept = { kind: "node", id: "a" } as const;
		session.select(kept);
		session.edit(movedTo(10));
		session.undo();
		expect(session.get().selection).toBe(kept);
		session.redo();
		expect(session.get().selection).toBe(kept);
	});

	test("undo of a node added and selected in the open Section shows the whole flow", () => {
		// Today's order: the selection from before the undo counts first,
		// and the node it holds is gone, so it lies outside the Section.
		const { session } = sessionOn(sectioned);
		session.openSection("one");
		const { flow: next, id } = withNode(session.get().draft);
		session.add(next);
		session.select({ kind: "node", id });
		session.settle();
		expect(session.get().openSection).toBe("one");
		session.undo();
		expect(session.get()).toMatchObject({
			openSection: null,
			selection: null,
		});
	});

	test("an undo that takes the open Section away keeps it, and redo opens it again", () => {
		const { session } = sessionOn(flow);
		const made = session.makeSection(["a", "b"]);
		if (!made.ok) throw new Error("expected a Section");
		session.openSection(made.id);
		session.undo();
		expect(session.get().draft.sections).toBeUndefined();
		expect(session.get().openSection).toBe(made.id);
		session.redo();
		expect(session.get().openSection).toBe(made.id);
	});
});

describe("the editing session: selecting a node shows its level", () => {
	test("a node in another Section opens that Section", () => {
		const { session } = sessionOn(sectioned);
		expect(session.selectNode("c")).toBe(false);
		expect(session.get()).toMatchObject({
			openSection: "two",
			selection: { kind: "node", id: "c" },
		});
		expect(session.selectNode("f")).toBe(false);
		expect(session.get().openSection).toBe("inner");
	});

	test("a node in the open Section keeps the view", () => {
		const { session } = sessionOn(sectioned);
		session.openSection("one");
		expect(session.selectNode("b")).toBe(true);
		expect(session.get().openSection).toBe("one");
	});

	test("a node in no Section shows the whole flow", () => {
		const { session } = sessionOn(sectioned);
		expect(session.selectNode("d")).toBe(true);
		session.openSection("one");
		expect(session.selectNode("d")).toBe(false);
		expect(session.get().openSection).toBeNull();
	});
});

describe("the editing session: settle after a render", () => {
	test("something selected outside the open Section shows the whole flow", () => {
		const { session } = sessionOn(sectioned);
		session.openSection("one");
		session.select({ kind: "nodes", ids: ["a", "c"] });
		session.settle();
		expect(session.get().openSection).toBeNull();
	});

	test("a node or a Section inside it keeps it open, at any depth", () => {
		const { session } = sessionOn(sectioned);
		session.openSection("outer");
		session.select({ kind: "node", id: "f" });
		session.settle();
		session.select({ kind: "section", id: "inner" });
		session.settle();
		session.select({ kind: "nodes", ids: ["e"], sections: ["inner"] });
		session.settle();
		session.select({ kind: "edge", id: "a-pass-b" });
		session.settle();
		expect(session.get().openSection).toBe("outer");

		session.select({ kind: "section", id: "one" });
		session.settle();
		expect(session.get().openSection).toBeNull();
	});

	test("a handler that changes the draft, then the selection, counts where it ends", () => {
		const { session } = sessionOn(sectioned);
		session.openSection("one");
		session.select({ kind: "node", id: "a" });
		// A rename selects the node under its new name.
		session.edit((draft) => renameNode(draft, "a", "z"));
		session.select({ kind: "node", id: "z" });
		session.settle();
		expect(session.get().openSection).toBe("one");
		// A cut drops the selection with the nodes.
		session.edit((draft) => removeNode(draft, "z"));
		session.select(null);
		session.settle();
		expect(session.get().openSection).toBe("one");
	});

	test("with no Section open, or one the draft lost, nothing changes", () => {
		const { session } = sessionOn(sectioned);
		session.select({ kind: "node", id: "c" });
		const before = session.get();
		session.settle();
		expect(session.get()).toBe(before);
		session.openSection("gone");
		session.settle();
		expect(session.get().openSection).toBe("gone");
	});
});

describe("the editing session: making a Section", () => {
	test("a Section of the nodes is selected and marked as made, in one step", () => {
		const { session } = sessionOn(sectioned);
		const made = session.makeSection(["d"]);
		if (!made.ok) throw new Error("expected a Section");
		expect(sectionOf(session.get().draft, "d")?.id).toBe(made.id);
		expect(session.get()).toMatchObject({
			selection: { kind: "section", id: made.id },
			madeSection: made.id,
		});
		session.undo();
		expect(session.get().draft).toBe(sectioned);
		expect(session.get().selection).toBeNull();
	});

	test("nodes that cannot form one give the problems and change nothing", () => {
		const { session } = sessionOn(sectioned);
		const before = session.get();
		const made = session.makeSection(["a", "c"]);
		expect(made.ok).toBe(false);
		expect(session.get()).toBe(before);
	});

	test("a Section made in the open Section keeps it open", () => {
		const { session } = sessionOn(sectioned);
		session.openSection("one");
		const made = session.makeSection(["a"]);
		if (!made.ok) throw new Error("expected a Section");
		session.settle();
		expect(session.get().openSection).toBe("one");
		// The undo takes the made Section, still selected: it lies outside.
		session.undo();
		expect(session.get().openSection).toBeNull();
	});
});
