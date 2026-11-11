import { describe, expect, test } from "bun:test";
import { hasFolder } from "./folder";
import type { Project } from "./types";

describe("hasFolder", () => {
	test("a project with a folder, and one without", () => {
		expect(hasFolder({ folder: true })).toBe(true);
		expect(hasFolder({ folder: false })).toBe(false);
	});

	test("a project from an older Host, which sends no folder, has one", () => {
		const older = {} as Pick<Project, "folder">;
		expect(hasFolder(older)).toBe(true);
	});
});
