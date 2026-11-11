import { describe, expect, test } from "bun:test";
import type { RunFiles } from "@nightshift/client";
import { runFilePath, showsRunFiles } from "./run-files";

const files = (more: Partial<RunFiles>): RunFiles => ({
	here: true,
	files: [],
	more: false,
	cleanupAt: null,
	removed: null,
	...more,
});

describe("runFilePath", () => {
	test("encodes each part of the path, and keeps the folders", () => {
		expect(runFilePath("r 1", "report/my notes #1.md")).toBe(
			"/api/runs/r%201/files/report/my%20notes%20%231.md",
		);
	});

	test("asks for a download", () => {
		expect(runFilePath("r1", "out.csv", true)).toBe(
			"/api/runs/r1/files/out.csv?download",
		);
	});
});

describe("showsRunFiles", () => {
	test("nothing before the answer, or for an empty folder here", () => {
		expect(showsRunFiles(undefined)).toBe(false);
		expect(showsRunFiles(files({}))).toBe(false);
	});

	test("the files here", () => {
		expect(
			showsRunFiles(
				files({ files: [{ path: "a.md", size: 3, modifiedAt: 1 }] }),
			),
		).toBe(true);
	});

	test("why none is here: removed, or on another computer", () => {
		expect(
			showsRunFiles(files({ here: false, removed: { at: 1, by: "cleanup" } })),
		).toBe(true);
		expect(showsRunFiles(files({ here: false }))).toBe(true);
	});
});
