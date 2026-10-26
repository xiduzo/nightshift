import { describe, expect, test } from "bun:test";
import { type Flow, moveNode, newFlow, updateNode } from "@nightshift/flows";
import { canUndo, undoDraft } from "./draft-undo";

/** The editor's draft as React state: each change runs on the latest draft. */
function editorDraft(initial: Flow) {
	let draft = initial;
	return {
		readFlow: () => draft,
		changeFlow: (change: (flow: Flow) => Flow) => {
			draft = change(draft);
		},
	};
}

const before = newFlow();
const nodeId = before.nodes[0]?.id ?? "";
const after = updateNode(before, nodeId, (node) => ({
	...node,
	name: "Proposed",
}));

describe("Apply, then Undo", () => {
	test("brings the draft back", () => {
		const editor = editorDraft(before);
		editor.changeFlow(() => after);
		expect(undoDraft(editor, { before, after })).toBe(true);
		expect(editor.readFlow()).toBe(before);
	});

	test("still works after the canvas made a new object of the same flow", () => {
		// The canvas reports a node "moved" to where it is: a new draft object,
		// the same flow. An Undo that compared objects only did nothing here.
		const editor = editorDraft(before);
		editor.changeFlow(() => after);
		const node = after.nodes[0];
		if (!node) throw new Error("no node");
		editor.changeFlow((flow) => moveNode(flow, node.id, node.position));
		expect(editor.readFlow()).not.toBe(after);
		expect(undoDraft(editor, { before, after })).toBe(true);
		expect(editor.readFlow()).toBe(before);
	});

	test("keeps a real change made since, and says it did not undo", () => {
		const editor = editorDraft(before);
		editor.changeFlow(() => after);
		editor.changeFlow((flow) =>
			updateNode(flow, nodeId, (node) => ({ ...node, name: "Mine" })),
		);
		const changed = editor.readFlow();
		expect(undoDraft(editor, { before, after })).toBe(false);
		expect(editor.readFlow()).toBe(changed);
	});

	test("canUndo: the same flow in a new object counts as unchanged", () => {
		expect(canUndo(after, after)).toBe(true);
		expect(canUndo(structuredClone(after), after)).toBe(true);
		expect(canUndo(before, after)).toBe(false);
	});
});
