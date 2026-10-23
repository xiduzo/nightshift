/// <reference types="bun" />
import { expect, test } from "bun:test";

import { initialsOf } from "./initials";

test("takes the first letter of the first two words", () => {
	expect(initialsOf("Sam Boer")).toBe("SB");
	expect(initialsOf("api-server")).toBe("AS");
	expect(initialsOf("  zaak afhandel component ")).toBe("ZA");
});

test("takes two letters of a single word", () => {
	expect(initialsOf("website")).toBe("WE");
	expect(initialsOf("x")).toBe("X");
	expect(initialsOf("émile")).toBe("ÉM");
});

test("is a question mark without letters", () => {
	expect(initialsOf("")).toBe("?");
	expect(initialsOf(" - ")).toBe("?");
});
