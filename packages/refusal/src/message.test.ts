import { expect, test } from "bun:test";

import { messageOf } from "./message";
import { Refusal } from "./refusal";

test("an error says its message, also an empty one, and never its cause", () => {
	expect(messageOf(new TypeError("x is undefined"))).toBe("x is undefined");
	expect(messageOf(new Refusal("conflict", "Stop the run first."))).toBe(
		"Stop the run first.",
	);
	expect(messageOf(new Error("", { cause: "deep" }))).toBe("");
});

test("any other thrown value is text", () => {
	expect(messageOf("exit code 128")).toBe("exit code 128");
	expect(messageOf(undefined)).toBe("undefined");
	expect(messageOf({ message: "not an error" })).toBe("[object Object]");
});
