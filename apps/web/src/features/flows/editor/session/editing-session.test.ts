import { describe, expect, test } from "bun:test";
import {
	FLOW_VERSION,
	type Flow,
	moveNodes,
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
	edges: [],
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
