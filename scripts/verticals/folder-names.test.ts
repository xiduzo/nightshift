/**
 * Rule (n) of scripts/check-verticals.ts: no kind folder inside a vertical,
 * at any depth. One tree breaks it and one keeps it. The debt list lets a
 * listed folder pass, and fails a line once its folder is gone.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";

import {
	checkWorkspace,
	checkWorkspaces,
	ENTRY_DIRS,
	PEER_PORTS,
} from "../check-verticals";
import { debtList, KIND_FOLDER_DEBT, linesOf, NESTING_DEBT } from "./debt";
import { KIND_FOLDERS } from "./folder-names";
import { inWorkspace, removeTrees, writeTree } from "./test-support";

afterAll(removeTrees);

const APP = "apps/demo";

/** An app with one vertical. `folders` each get one file that it imports. */
const app = (folders: string[]): Record<string, string> => ({
	"src/main.ts":
		'import { RunList } from "./features/runs";\nexport default RunList;\n',
	"src/features/runs/index.ts": 'export { RunList } from "./run-list";\n',
	"src/features/runs/run-list.ts": "export const RunList = 1;\n",
	...Object.fromEntries(
		folders.map((folder) => [
			`src/features/runs/${folder}/part.ts`,
			"export const part = 1;\n",
		]),
	),
});

const check = (files: Record<string, string>, kindFolderDebt?: string[]) =>
	checkWorkspace(writeTree(inWorkspace(APP, files)), APP, {
		entryDirs: ["routes"],
		kindFolderDebt,
	});

const problem = (folder: string) => {
	const name = folder.split("/").pop();
	return `apps/demo/src/features/runs/${folder}/: "${name}" is a kind folder inside the vertical features/runs. Name a folder for its sub-domain, and move each file into the sub-domain that uses it.`;
};

describe("no kind folder inside a vertical (n)", () => {
	test("the list is the kind buckets, queries and mutations", () => {
		expect([...KIND_FOLDERS].sort()).toEqual([
			"common",
			"components",
			"helpers",
			"hooks",
			"lib",
			"misc",
			"mutations",
			"queries",
			"types",
			"utils",
		]);
	});

	test("a kind folder directly in a vertical fails, each name once", () => {
		const kinds = [
			"components",
			"hooks",
			"lib",
			"mutations",
			"queries",
			"types",
		];
		expect(check(app(kinds))).toEqual(kinds.map(problem));
	});

	test("a kind folder fails at any depth, inside a sub-vertical too", () => {
		expect(
			check({
				...app(["details/steps/hooks", "transcript/components"]),
				"src/features/runs/run-list.ts":
					'import { Transcript } from "./transcript";\nexport const RunList = Transcript;\n',
				"src/features/runs/transcript/index.ts":
					'export { Transcript } from "./transcript";\n',
				"src/features/runs/transcript/transcript.ts":
					"export const Transcript = 1;\n",
			}),
		).toEqual([
			problem("details/steps/hooks"),
			problem("transcript/components"),
		]);
	});

	test("a kind folder with no source file fails too", () => {
		expect(
			check({
				...app([]),
				"src/features/runs/components/run.css": ".run {}\n",
			}),
		).toEqual([problem("components")]);
	});

	test("a folder named for a sub-domain passes, and so does a kind file", () => {
		expect(
			check({
				...app(["details", "transcript/items"]),
				"src/features/runs/queries.ts": "export const runQueries = 1;\n",
				"src/features/runs/details/hooks.ts": "export const useRun = 1;\n",
			}),
		).toEqual([]);
	});

	test("a kind folder outside a vertical is not this rule's", () => {
		// In the entry folder, and outside src/: no vertical holds them.
		expect(
			check({
				...app([]),
				"src/routes/components/page.ts": "export const page = 1;\n",
				"scripts/lib/build.ts": "export const build = 1;\n",
			}),
		).toEqual([]);
	});

	test("a catch-all folder fails once, as a catch-all name (k)", () => {
		expect(check(app(["utils", "helpers"]))).toEqual([
			'apps/demo/src/features/runs/helpers/: "helpers" is a catch-all folder. Name it for what it holds, or move each file into the folder that uses it.',
			'apps/demo/src/features/runs/utils/: "utils" is a catch-all folder. Name it for what it holds, or move each file into the folder that uses it.',
		]);
	});
});

describe("the debt list of kind folders", () => {
	const listed = "apps/demo/src/features/runs/hooks";

	test("a folder that is not listed fails, a listed folder passes", () => {
		expect(check(app(["hooks", "lib"]), [])).toEqual([
			problem("hooks"),
			problem("lib"),
		]);
		expect(check(app(["hooks", "lib"]), [listed])).toEqual([problem("lib")]);
		expect(check(app(["hooks"]), [listed])).toEqual([]);
	});

	test("a listed folder that is gone fails", () => {
		expect(check(app(["live"]), [listed])).toEqual([
			`scripts/kind-folder-debt.txt: "${listed}" is clean now. Remove the line.`,
		]);
	});

	test("the command reads scripts/kind-folder-debt.txt, for each workspace its own lines", () => {
		const tree = (debt: string) =>
			writeTree({
				...inWorkspace(APP, {
					...app(["hooks"]),
					"package.json": "{}",
				}),
				...inWorkspace("apps/other", {
					...app(["lib"]),
					"package.json": "{}",
				}),
				[KIND_FOLDER_DEBT]: debt,
			});
		const both = `# Why.\n${listed}\napps/other/src/features/runs/lib # Until the move.\n`;
		expect(checkWorkspaces(tree(both), [APP, "apps/other"])).toEqual([]);
		// The line of another workspace is not this workspace's to judge.
		expect(checkWorkspaces(tree(both), [APP])).toEqual([]);
		expect(checkWorkspaces(tree(`${listed}\n`), [APP, "apps/other"])).toEqual([
			'apps/other/src/features/runs/lib/: "lib" is a kind folder inside the vertical features/runs. Name a folder for its sub-domain, and move each file into the sub-domain that uses it.',
		]);
	});

	test("a line that names no checked workspace fails", () => {
		const root = writeTree({
			...inWorkspace(APP, { ...app([]), "package.json": "{}" }),
			"packages/ui/package.json": "{}",
			[KIND_FOLDER_DEBT]: "packages/ui/src/components\napps/gone/src/lib\n",
		});
		expect(checkWorkspaces(root, [APP])).toEqual([
			'scripts/kind-folder-debt.txt: "packages/ui/src/components" names no path of a checked workspace. Remove the line.',
			'scripts/kind-folder-debt.txt: "apps/gone/src/lib" names no path of a checked workspace. Remove the line.',
		]);
	});

	test("this repository passes with its list, and every line of it is needed", () => {
		const root = join(import.meta.dir, "../..");
		const web = (kindFolderDebt: string[]) =>
			checkWorkspace(root, "apps/web", {
				peerPorts: PEER_PORTS["apps/web"],
				entryDirs: ENTRY_DIRS["apps/web"],
				nestingDebt: linesOf(debtList(root, NESTING_DEBT), "apps/web"),
				kindFolderDebt,
			});
		// The web app holds every kind folder of today. An empty list passes.
		const lines = linesOf(debtList(root, KIND_FOLDER_DEBT), "apps/web");
		expect(web(lines)).toEqual([]);
		expect(web([])).toHaveLength(lines.length);
	}, 120_000);
});
