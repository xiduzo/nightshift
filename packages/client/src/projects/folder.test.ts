import { describe, expect, test } from "bun:test";
import { hasFolder } from "./folder";

describe("hasFolder", () => {
	test("a project with a folder, and one without", () => {
		expect(hasFolder({ folder: true })).toBe(true);
		expect(hasFolder({ folder: false })).toBe(false);
	});
});
