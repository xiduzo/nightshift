import { describe, expect, test } from "bun:test";
import { lineDiff, templateParts } from "./line-diff";

describe("lineDiff", () => {
	test("keeps common lines and marks the rest", () => {
		expect(lineDiff("a\nb\nc", "a\nB\nc\nd")).toEqual([
			{ kind: "same", text: "a" },
			{ kind: "removed", text: "b" },
			{ kind: "added", text: "B" },
			{ kind: "same", text: "c" },
			{ kind: "added", text: "d" },
		]);
	});

	test("an empty text before is all added lines", () => {
		expect(lineDiff("", "one\ntwo").map((line) => line.kind)).toEqual([
			"added",
			"added",
		]);
	});

	test("an empty text after is all removed lines", () => {
		expect(lineDiff("one", "")).toEqual([{ kind: "removed", text: "one" }]);
	});

	test("the same text is all kept", () => {
		expect(lineDiff("x\ny", "x\ny").every((line) => line.kind === "same")).toBe(
			true,
		);
	});
});

describe("templateParts", () => {
	test("cuts out the references", () => {
		expect(templateParts("Fix {{check.log_tail}} now")).toEqual([
			{ text: "Fix ", ref: false },
			{ text: "{{check.log_tail}}", ref: true },
			{ text: " now", ref: false },
		]);
	});

	test("a line without references is one plain part", () => {
		expect(templateParts("plain")).toEqual([{ text: "plain", ref: false }]);
	});
});
