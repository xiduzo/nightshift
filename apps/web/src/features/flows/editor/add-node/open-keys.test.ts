import { describe, expect, test } from "bun:test";
import { type FocusHistory, opensAddNode } from "./open-keys";

const body = { closest: () => null };

/** An element inside the parts that `inside` names, by selector part. */
function element(...inside: string[]) {
	return {
		closest: (selectors: string) =>
			inside.some((part) => selectors.includes(part)) ? {} : null,
	};
}

const node = element(".react-flow__node");
const edge = element(".react-flow__edge");
const input = element("input");
const inDialog = element("[role='dialog']");
const inMenu = element("[role='menu']");
const button = element("button");

function tab(target: unknown, change: Partial<KeyboardEvent> = {}) {
	return {
		key: "Tab",
		shiftKey: false,
		metaKey: false,
		ctrlKey: false,
		altKey: false,
		defaultPrevented: false,
		target,
		...change,
	};
}

const clicked: FocusHistory = { focusedBy: "pointer", lastInput: "pointer" };
const tabbed: FocusHistory = { focusedBy: "tab", lastInput: "tab" };

describe("opensAddNode", () => {
	test("Tab on the page after a click opens the dialog", () => {
		expect(opensAddNode(tab(body), clicked, body)).toBe(true);
		expect(opensAddNode(tab(null), clicked, body)).toBe(true);
	});

	test("Tab on the page from the keyboard moves on through the page", () => {
		expect(opensAddNode(tab(body), tabbed, body)).toBe(false);
		expect(
			opensAddNode(tab(body), { focusedBy: null, lastInput: null }, body),
		).toBe(false);
	});

	test("a node or an edge that a click focused opens it", () => {
		expect(opensAddNode(tab(node), clicked, body)).toBe(true);
		expect(opensAddNode(tab(edge), clicked, body)).toBe(true);
	});

	test("a node the focus reached with Tab keeps Tab", () => {
		expect(opensAddNode(tab(node), tabbed, body)).toBe(false);
		expect(
			opensAddNode(tab(node), { focusedBy: "tab", lastInput: "pointer" }, body),
		).toBe(false);
	});

	test("fields, dialogs and menus keep Tab", () => {
		for (const target of [input, inDialog, inMenu]) {
			expect(opensAddNode(tab(target), clicked, body)).toBe(false);
		}
		// A field on a node: the field wins.
		const fieldOnNode = element("input", ".react-flow__node");
		expect(opensAddNode(tab(fieldOnNode), clicked, body)).toBe(false);
	});

	test("a button outside the canvas keeps Tab", () => {
		expect(opensAddNode(tab(button), clicked, body)).toBe(false);
	});

	test("only Tab with no modifier, and not when something took the key", () => {
		expect(opensAddNode(tab(body, { shiftKey: true }), clicked, body)).toBe(
			false,
		);
		expect(opensAddNode(tab(body, { metaKey: true }), clicked, body)).toBe(
			false,
		);
		expect(opensAddNode(tab(body, { ctrlKey: true }), clicked, body)).toBe(
			false,
		);
		expect(opensAddNode(tab(body, { altKey: true }), clicked, body)).toBe(
			false,
		);
		expect(
			opensAddNode(tab(body, { defaultPrevented: true }), clicked, body),
		).toBe(false);
		expect(opensAddNode(tab(body, { key: "a" }), clicked, body)).toBe(false);
	});
});
