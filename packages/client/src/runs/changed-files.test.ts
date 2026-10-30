import { describe, expect, test } from "bun:test";
import { changedFiles, fileTree } from "./changed-files";

const ROOT = "/work/copies/run-1";

describe("changedFiles", () => {
	test("is empty when the step changed nothing", () => {
		expect(
			changedFiles([{ name: "Read", input: { file_path: `${ROOT}/a.ts` } }]),
		).toEqual([]);
	});

	test("reads Claude Code's Edit, MultiEdit and Write, relative to the project", () => {
		const files = changedFiles(
			[
				{
					name: "Edit",
					input: {
						file_path: `${ROOT}/src/a.ts`,
						old_string: "one",
						new_string: "two",
					},
				},
				{
					name: "MultiEdit",
					input: {
						file_path: `${ROOT}/src/a.ts`,
						edits: [
							{ old_string: "x", new_string: "y" },
							{ old_string: "p", new_string: "q" },
						],
					},
				},
				{
					name: "Write",
					input: { file_path: `${ROOT}/src/new.ts`, content: "hello" },
					result: `File created successfully at: ${ROOT}/src/new.ts`,
				},
				{
					name: "Write",
					input: { file_path: `${ROOT}/README.md`, content: "all new" },
					result: `The file ${ROOT}/README.md has been updated successfully.`,
				},
			],
			ROOT,
		);
		expect(files).toEqual([
			{
				path: "README.md",
				status: "edited",
				changes: [{ kind: "write", content: "all new" }],
			},
			{
				path: "src/a.ts",
				status: "edited",
				changes: [
					{ kind: "edit", before: "one", after: "two" },
					{ kind: "edit", before: "x", after: "y" },
					{ kind: "edit", before: "p", after: "q" },
				],
			},
			{
				path: "src/new.ts",
				status: "added",
				changes: [{ kind: "write", content: "hello" }],
			},
		]);
	});

	test("a failed call changed nothing", () => {
		expect(
			changedFiles([
				{
					name: "Edit",
					input: { file_path: "a.ts", old_string: "a", new_string: "b" },
					failed: true,
				},
			]),
		).toEqual([]);
	});

	test("reads OpenCode's edit and write, and keeps a path outside the project", () => {
		const files = changedFiles(
			[
				{
					name: "edit",
					input: {
						filePath: "/elsewhere/b.ts",
						oldString: "a",
						newString: "b",
					},
				},
				{ name: "write", input: { filePath: "./c.ts", content: "c" } },
			],
			ROOT,
		);
		expect(files.map((file) => [file.path, file.status])).toEqual([
			["/elsewhere/b.ts", "edited"],
			["c.ts", "added"],
		]);
	});

	test("reads an apply_patch patch: add, update with a move, delete", () => {
		const patchText = [
			"*** Begin Patch",
			"*** Add File: docs/new.md",
			"+# New",
			"+text",
			"*** Update File: src/old.ts",
			"*** Move to: src/moved.ts",
			"@@ function a()",
			"-return 1;",
			"+return 2;",
			" }",
			"*** Delete File: gone.txt",
			"*** End Patch",
		].join("\n");
		expect(
			changedFiles([{ name: "apply_patch", input: { patchText } }]),
		).toEqual([
			{
				path: "docs/new.md",
				status: "added",
				changes: [{ kind: "write", content: "# New\ntext" }],
			},
			{ path: "gone.txt", status: "deleted", changes: [{ kind: "delete" }] },
			{
				path: "src/moved.ts",
				status: "edited",
				changes: [
					{
						kind: "patch",
						diff: "@@ function a()\n-return 1;\n+return 2;\n }",
					},
				],
			},
		]);
	});

	test("reads Codex's file_change, which names the files only", () => {
		expect(
			changedFiles(
				[
					{
						name: "file_change",
						input: {
							changes: [
								{ path: `${ROOT}/a.ts`, kind: "update" },
								{ path: `${ROOT}/b.ts`, kind: "add" },
								{ path: `${ROOT}/c.ts`, kind: "delete" },
							],
						},
					},
				],
				ROOT,
			).map((file) => [file.path, file.status]),
		).toEqual([
			["a.ts", "edited"],
			["b.ts", "added"],
			["c.ts", "deleted"],
		]);
	});

	test("reads an ACP edit from the diffs in its answer", () => {
		const files = changedFiles([
			{
				name: "edit",
				input: { title: "Edit a.ts" },
				result: JSON.stringify([
					{ type: "diff", path: "a.ts", oldText: "1", newText: "2" },
					{ type: "diff", path: "b.ts", oldText: null, newText: "new" },
				]),
			},
		]);
		expect(files).toEqual([
			{
				path: "a.ts",
				status: "edited",
				changes: [{ kind: "edit", before: "1", after: "2" }],
			},
			{
				path: "b.ts",
				status: "added",
				changes: [{ kind: "write", content: "new" }],
			},
		]);
	});
});

describe("fileTree", () => {
	test("folders before files, and a lone folder chain joins into one row", () => {
		const tree = fileTree([
			{ path: "README.md" },
			{ path: "src/features/runs/a.ts" },
			{ path: "src/features/runs/b.ts" },
			{ path: "src/index.ts" },
			{ path: "docs/guide/intro.md" },
		]);
		expect(tree.map((node) => [node.kind, node.name, node.path])).toEqual([
			["folder", "docs/guide", "docs/guide"],
			["folder", "src", "src"],
			["file", "README.md", "README.md"],
		]);
		const src = tree[1];
		if (src?.kind !== "folder") throw new Error("src is a folder");
		expect(
			src.children.map((node) => [node.kind, node.name, node.path]),
		).toEqual([
			["folder", "features/runs", "src/features/runs"],
			["file", "index.ts", "src/index.ts"],
		]);
	});
});
