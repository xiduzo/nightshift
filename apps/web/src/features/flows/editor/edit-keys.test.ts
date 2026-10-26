import { describe, expect, test } from "bun:test";
import { editKeyOf } from "./edit-keys";

const press = (
	key: string,
	keys: { shift?: boolean; ctrl?: boolean } = {},
) => ({
	key,
	metaKey: !keys.ctrl,
	ctrlKey: keys.ctrl ?? false,
	shiftKey: keys.shift ?? false,
	altKey: false,
});

describe("editKeyOf", () => {
	test("reads undo, redo, copy, cut and paste with ⌘ or Ctrl", () => {
		expect(editKeyOf(press("z"))).toBe("undo");
		expect(editKeyOf(press("Z", { shift: true }))).toBe("redo");
		expect(editKeyOf(press("y", { ctrl: true }))).toBe("redo");
		expect(editKeyOf(press("c"))).toBe("copy");
		expect(editKeyOf(press("x", { ctrl: true }))).toBe("cut");
		expect(editKeyOf(press("v"))).toBe("paste");
	});

	test("needs ⌘ or Ctrl, and no other key", () => {
		expect(editKeyOf({ ...press("z"), metaKey: false })).toBeNull();
		expect(editKeyOf({ ...press("c"), altKey: true })).toBeNull();
		expect(editKeyOf(press("v", { shift: true }))).toBeNull();
		expect(editKeyOf(press("s"))).toBeNull();
	});
});
