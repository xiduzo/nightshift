import { describe, expect, test } from "bun:test";
import {
	fileNameOf,
	folderOf,
	folderTrail,
	folderTree,
	isInFolder,
} from "./folder-tree";

describe("folderTree", () => {
	test("counts the files of a folder and of the folders below it", () => {
		const tree = folderTree([
			"data/catalog.md",
			"research/papers/a.md",
			"research/papers/b.md",
			"research/web/c.md",
			"top.md",
		]);
		expect(tree.count).toBe(5);
		expect(tree.children.map((child) => [child.path, child.count])).toEqual([
			["data", 1],
			["research", 3],
		]);
		expect(
			tree.children[1]?.children.map((child) => [child.path, child.count]),
		).toEqual([
			["research/papers", 2],
			["research/web", 1],
		]);
	});

	test("folders come by name, in whatever order the files come", () => {
		const tree = folderTree(["z/a.md", "a/a.md", "m/a.md"]);
		expect(tree.children.map((child) => child.name)).toEqual(["a", "m", "z"]);
	});

	test("no files: an empty top", () => {
		expect(folderTree([])).toEqual({
			name: "",
			path: "",
			count: 0,
			children: [],
		});
	});
});

describe("isInFolder", () => {
	test("the top holds everything", () => {
		expect(isInFolder("a/b.md", "")).toBe(true);
	});

	test("a folder holds its files and those of the folders below it", () => {
		expect(isInFolder("a/b.md", "a")).toBe(true);
		expect(isInFolder("a/c/b.md", "a")).toBe(true);
	});

	test("a folder whose name only starts the same does not", () => {
		expect(isInFolder("ab/c.md", "a")).toBe(false);
	});
});

test("folderTrail goes from the top to the folder", () => {
	expect(folderTrail("")).toEqual([]);
	expect(folderTrail("a/b")).toEqual([
		{ name: "a", path: "a" },
		{ name: "b", path: "a/b" },
	]);
});

test("a file's folder and name", () => {
	expect(folderOf("a/b/c.md")).toBe("a/b");
	expect(folderOf("c.md")).toBe("");
	expect(fileNameOf("a/b/c.md")).toBe("c.md");
});
