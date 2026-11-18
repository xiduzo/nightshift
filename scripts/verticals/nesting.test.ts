/**
 * Rule (o) of scripts/check-verticals.ts: the barrel of a sub-vertical.
 * Each rule has one tree that breaks it and one that keeps it. The debt
 * list of (o) and (p) lets a listed offender pass, and fails a line once
 * it is clean. Rule (p) itself: nesting-size.test.ts.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";

import {
	checkWorkspace,
	checkWorkspaces,
	LEAF_CONTRACTS,
	type Options,
} from "../check-verticals";
import { debtList, linesOf, NESTING_DEBT } from "./debt";
import {
	inWorkspace,
	removeTrees,
	sourceFiles,
	writeTree,
} from "./test-support";

afterAll(removeTrees);

const PKG = "packages/demo";

const check = (files: Record<string, string>, options: Options = {}) =>
	checkWorkspace(writeTree(inWorkspace(PKG, files)), PKG, options);

/**
 * A package with the vertical `flows`. It holds the sub-vertical `editor`,
 * and that one holds the sub-vertical `inspector`.
 */
const flows = {
	"src/index.ts": 'export { page } from "./flows";\n',
	"src/flows/index.ts": 'export { page } from "./page";\n',
	"src/flows/page.ts":
		'import { Editor } from "./editor";\nexport const page = Editor;\n',
	"src/flows/editor/index.ts": 'export { Editor } from "./editor";\n',
	"src/flows/editor/editor.ts":
		'import { canvas } from "./canvas";\nimport { Inspector } from "./inspector";\nexport const Editor = [canvas, Inspector];\n',
	"src/flows/editor/canvas.ts": "export const canvas = 1;\n",
	"src/flows/editor/inspector/index.ts":
		'export { Inspector } from "./inspector";\n',
	"src/flows/editor/inspector/inspector.ts":
		'import { field } from "./field";\nexport const Inspector = field;\n',
	"src/flows/editor/inspector/field.ts": "export const field = 1;\n",
};

const past = (file: string, specifier: string, unit: string, barrel: string) =>
	`packages/demo/src/${file}: imports "${specifier}" past the barrel of ${unit}, a sub-vertical. Import "${barrel}" instead.`;

describe("a sub-vertical is imported through its barrel (o)", () => {
	test("imports through each barrel pass, and inside one any file is in reach", () => {
		expect(check(flows)).toEqual([]);
	});

	test("an import past the barrel of a sub-vertical fails, from its own vertical", () => {
		expect(
			check({
				...flows,
				"src/flows/page.ts":
					'import { Editor } from "./editor";\nimport { canvas } from "./editor/canvas";\nexport const page = [Editor, canvas];\n',
			}),
		).toEqual([
			past("flows/page.ts", "./editor/canvas", "flows/editor", "./editor"),
		]);
	});

	test("the vertical's own barrel may not reach past it either", () => {
		expect(
			check({
				...flows,
				"src/index.ts": 'export { canvas, page } from "./flows";\n',
				"src/flows/index.ts":
					'export { canvas } from "./editor/canvas";\nexport { page } from "./page";\n',
			}),
		).toEqual([
			past("flows/index.ts", "./editor/canvas", "flows/editor", "./editor"),
		]);
	});

	test("it holds at every depth: the outer barrel guards the inner sub-vertical", () => {
		expect(
			check({
				...flows,
				// The barrel of inspector is still past the barrel of editor.
				"src/flows/page.ts":
					'import { Editor } from "./editor";\nimport { Inspector } from "./editor/inspector";\nexport const page = [Editor, Inspector];\n',
				// Inside editor, inspector opens only through its own barrel.
				"src/flows/editor/canvas.ts":
					'import { field } from "./inspector/field";\nexport const canvas = field;\n',
			}),
		).toEqual([
			past(
				"flows/editor/canvas.ts",
				"./inspector/field",
				"flows/editor/inspector",
				"./inspector",
			),
			past("flows/page.ts", "./editor/inspector", "flows/editor", "./editor"),
		]);
	});

	test("a sub-vertical reaches up freely, and its neighbour through the barrel", () => {
		const chat = {
			...flows,
			"src/flows/page.ts":
				'import { Chat } from "./chat";\nimport { Editor } from "./editor";\nexport const page = [Chat, Editor];\nexport const title = "Flows";\n',
			"src/flows/chat/index.ts": 'export { Chat } from "./chat";\n',
			// A file of the vertical, and a file of the sub-vertical that holds it.
			"src/flows/editor/inspector/field.ts":
				'import { canvas } from "../canvas";\nimport { title } from "../../page";\nexport const field = [canvas, title];\n',
		};
		expect(
			check({
				...chat,
				"src/flows/chat/chat.ts":
					'import { Editor } from "../editor";\nexport const Chat = Editor;\n',
			}),
		).toEqual([]);
		expect(
			check({
				...chat,
				"src/flows/chat/chat.ts":
					'import { Editor } from "../editor";\nimport { canvas } from "../editor/canvas";\nexport const Chat = [Editor, canvas];\n',
			}),
		).toEqual([
			past(
				"flows/chat/chat.ts",
				"../editor/canvas",
				"flows/editor",
				"../editor",
			),
		]);
	});

	test("a file with two imports past one barrel fails once", () => {
		expect(
			check({
				...flows,
				"src/flows/page.ts":
					'import { Editor } from "./editor";\nimport { canvas } from "./editor/canvas";\nimport type { Editor as E } from "./editor/editor";\nexport const page = [Editor, canvas] as E[];\n',
			}),
		).toEqual([
			past("flows/page.ts", "./editor/canvas", "flows/editor", "./editor"),
		]);
	});

	test("from another vertical, rule (a) decides: the barrel of the vertical", () => {
		expect(
			check({
				...flows,
				"src/index.ts":
					'export { page } from "./flows";\nexport { run } from "./runs";\n',
				"src/runs/index.ts": 'export { run } from "./run";\n',
				"src/runs/run.ts":
					'import { Editor } from "../flows/editor";\nexport const run = Editor;\n',
			}),
		).toEqual([
			'packages/demo/src/runs/run.ts: imports "../flows/editor" past the barrel of flows. Import "../flows" instead.',
		]);
	});

	test("a test may deep-import", () => {
		expect(
			check({
				...flows,
				"src/flows/page.test.ts":
					'import { field } from "./editor/inspector/field";\nfield;\n',
			}),
		).toEqual([]);
	});

	test("a folder with a barrel below a folder without one is a sub-vertical too", () => {
		const panels = {
			...flows,
			"src/flows/panels/chat/index.ts": 'export { Chat } from "./chat";\n',
			"src/flows/panels/chat/chat.ts": "export const Chat = 1;\n",
		};
		expect(
			check({
				...panels,
				"src/flows/page.ts":
					'import { Editor } from "./editor";\nimport { Chat } from "./panels/chat";\nexport const page = [Editor, Chat];\n',
			}),
		).toEqual([]);
		expect(
			check({
				...panels,
				"src/flows/page.ts":
					'import { Editor } from "./editor";\nimport { Chat } from "./panels/chat/chat";\nexport const page = [Editor, Chat];\n',
			}),
		).toEqual([
			past(
				"flows/page.ts",
				"./panels/chat/chat",
				"flows/panels/chat",
				"./panels/chat",
			),
			'packages/demo/src/flows/panels/chat/index.ts: nothing outside flows/panels/chat imports "Chat". Take it off the barrel.',
		]);
	});

	test("a folder of test helpers with an index.ts is no sub-vertical", () => {
		expect(
			check({
				...flows,
				"src/flows/fixtures/index.ts":
					'export { flow } from "./flow";\nexport const helper = () => 1;\n',
				"src/flows/fixtures/flow.ts": "export const flow = 1;\n",
				"src/flows/page.test.ts":
					'import { flow } from "./fixtures/flow";\nflow;\n',
			}),
		).toEqual([]);
	});
});

describe("the barrel of a sub-vertical (o)", () => {
	test("a barrel with code fails", () => {
		expect(
			check({
				...flows,
				"src/flows/editor/index.ts":
					'import { Editor as Base } from "./editor";\nexport const Editor = [Base];\n',
			}),
		).toEqual([
			"packages/demo/src/flows/editor/index.ts: a barrel holds only import and export statements. Move the code into a file of flows/editor and export it from there.",
		]);
	});

	test("a name that no file outside the sub-vertical imports fails, a test does not count", () => {
		expect(
			check({
				...flows,
				"src/flows/editor/index.ts":
					'export { canvas } from "./canvas";\nexport { Editor } from "./editor";\nexport { Inspector } from "./inspector";\n',
				"src/flows/page.test.ts":
					'import { canvas } from "./editor";\ncanvas;\n',
			}),
		).toEqual([
			'packages/demo/src/flows/editor/index.ts: nothing outside flows/editor imports "Inspector". Take it off the barrel.',
			'packages/demo/src/flows/editor/index.ts: nothing outside flows/editor imports "canvas". Take it off the barrel.',
		]);
	});

	test("an importer in the sub-vertical that holds it counts", () => {
		// editor.ts imports Inspector from ./inspector: it is outside inspector.
		expect(check(flows)).toEqual([]);
		expect(
			check({
				...flows,
				"src/flows/editor/editor.ts":
					'import { canvas } from "./canvas";\nexport const Editor = canvas;\n',
			}),
		).toEqual([
			'packages/demo/src/flows/editor/inspector/index.ts: nothing outside flows/editor/inspector imports "Inspector". Take it off the barrel.',
		]);
	});

	test("a barrel that package.json exports is a public entry", () => {
		expect(
			check({
				...flows,
				"package.json": JSON.stringify({
					exports: { "./editor": "./src/flows/editor/index.ts" },
				}),
				"src/flows/editor/index.ts":
					'export { canvas } from "./canvas";\nexport { Editor } from "./editor";\n',
			}),
		).toEqual([]);
	});
});

describe("the ring folders are not sub-verticals", () => {
	/** A slice: the rings of the hexagon directly in the vertical. */
	const slice = {
		"src/index.ts": 'export { answer } from "./gates";\n',
		"src/gates/index.ts": 'export { answer } from "./application/answer";\n',
		"src/gates/domain/gate.ts": "export const gate = 1;\n",
		"src/gates/application/answer.ts":
			'import { gate } from "../domain/gate";\nimport { store } from "../adapters/out/store";\nexport const answer = [gate, store];\n',
		"src/gates/adapters/out/store.ts": "export const store = 1;\n",
		"src/gates/adapters/in/timer.ts": "export const timer = 1;\n",
	};

	test("a ring folder needs no barrel, and an index.ts in one makes no barrel", () => {
		expect(check(slice)).toEqual([]);
		expect(
			check({
				...slice,
				"src/gates/domain/index.ts": 'export { gate } from "./gate";\n',
				"src/gates/adapters/index.ts": "export const wired = 1;\n",
				"src/gates/adapters/out/index.ts": 'export { store } from "./store";\n',
				"src/gates/adapters/in/index.ts": "export const timers = 2;\n",
			}),
		).toEqual([]);
	});

	test("a ring name is a ring only directly in a vertical or a sub-vertical", () => {
		const nested = {
			...slice,
			"src/gates/application/answer.ts":
				'import { gate } from "../domain/gate";\nimport { store } from "../adapters/out/store";\nimport { rule } from "../briefs/domain/rule";\nexport const answer = [gate, store, rule];\n',
			"src/gates/briefs/domain/rule.ts": "export const rule = 1;\n",
			"src/gates/briefs/domain/index.ts": 'export { rule } from "./rule";\n',
		};
		// briefs has no barrel, so briefs/domain is a folder with a barrel.
		expect(check(nested)).toEqual([
			past(
				"gates/application/answer.ts",
				"../briefs/domain/rule",
				"gates/briefs/domain",
				"../briefs/domain",
			),
			'packages/demo/src/gates/briefs/domain/index.ts: nothing outside gates/briefs/domain imports "rule". Take it off the barrel.',
		]);
		// With a barrel, briefs is a sub-vertical and briefs/domain is its ring.
		expect(
			check({
				...nested,
				"src/gates/application/answer.ts":
					'import { gate } from "../domain/gate";\nimport { store } from "../adapters/out/store";\nimport { rule } from "../briefs";\nexport const answer = [gate, store, rule];\n',
				"src/gates/briefs/index.ts": 'export { rule } from "./domain/rule";\n',
			}),
		).toEqual([]);
	});

	test("in and out are rings only in adapters/", () => {
		expect(
			check({
				...slice,
				"src/gates/application/answer.ts":
					'import { gate } from "../domain/gate";\nimport { store } from "../adapters/out/store";\nimport { hook } from "../in/hook";\nimport { log } from "../out/log";\nexport const answer = [gate, store, hook, log];\n',
				"src/gates/in/index.ts": 'export { hook } from "./hook";\n',
				"src/gates/in/hook.ts": "export const hook = 1;\n",
				"src/gates/out/index.ts": 'export { log } from "./log";\n',
				"src/gates/out/log.ts": "export const log = 1;\n",
			}),
		).toEqual([
			past("gates/application/answer.ts", "../in/hook", "gates/in", "../in"),
			past("gates/application/answer.ts", "../out/log", "gates/out", "../out"),
			'packages/demo/src/gates/in/index.ts: nothing outside gates/in imports "hook". Take it off the barrel.',
			'packages/demo/src/gates/out/index.ts: nothing outside gates/out imports "log". Take it off the barrel.',
		]);
	});
});

describe("the debt list of sub-verticals", () => {
	const page = {
		...flows,
		"src/flows/page.ts":
			'import { Editor } from "./editor";\nimport { canvas } from "./editor/canvas";\nexport const page = [Editor, canvas];\n',
	};
	const deep =
		"packages/demo/src/flows/page.ts -> packages/demo/src/flows/editor";
	const flat = {
		"src/runs/index.ts": 'export { run } from "./run";\n',
		"src/runs/run.ts":
			'import { page } from "../flows";\nexport const run = page;\n',
		...sourceFiles("src/runs", 18),
		...sourceFiles("src/runs/steps", 6),
	};
	const root = { "src/index.ts": 'export { run } from "./runs";\n' };

	test("an offender that is not listed fails, a listed one passes", () => {
		expect(check(page, { nestingDebt: [] })).toHaveLength(1);
		expect(check(page, { nestingDebt: [deep] })).toEqual([]);
		const both = { ...page, ...flat, ...root };
		expect(check(both, { nestingDebt: [deep] })).toEqual([
			expect.stringContaining(
				"packages/demo/src/runs/steps/: has no index.ts.",
			),
		]);
		expect(
			check(both, { nestingDebt: [deep, "packages/demo/src/runs/steps"] }),
		).toEqual([]);
	});

	test("a name and a barrel with code have their own lines", () => {
		const files = {
			...flows,
			"src/flows/editor/index.ts":
				'import { canvas } from "./canvas";\nexport { Editor } from "./editor";\nexport const Canvas = canvas;\n',
		};
		expect(check(files)).toHaveLength(2);
		expect(
			check(files, {
				nestingDebt: [
					"packages/demo/src/flows/editor/index.ts exports Canvas",
					"packages/demo/src/flows/editor/index.ts holds code",
				],
			}),
		).toEqual([]);
	});

	test("a listed line that is clean fails", () => {
		expect(
			check(flows, {
				nestingDebt: [deep, "packages/demo/src/flows/editor"],
			}),
		).toEqual([
			'scripts/nesting-debt.txt: "packages/demo/src/flows/editor" is clean now. Remove the line.',
			`scripts/nesting-debt.txt: "${deep}" is clean now. Remove the line.`,
		]);
	});

	test("the command reads scripts/nesting-debt.txt", () => {
		const tree = (debt: string) =>
			writeTree({
				...inWorkspace(PKG, { ...page, "package.json": "{}" }),
				[NESTING_DEBT]: debt,
			});
		expect(checkWorkspaces(tree(""), [PKG])).toHaveLength(1);
		expect(
			checkWorkspaces(tree(`# The page moves in phase 4.\n${deep}\n`), [PKG]),
		).toEqual([]);
		expect(
			checkWorkspaces(tree(`${deep}\npackages/gone/src/runs\n`), [PKG]),
		).toEqual([
			'scripts/nesting-debt.txt: "packages/gone/src/runs" names no path of a checked workspace. Remove the line.',
		]);
	});

	test("this repository passes with its list, and every line of it is needed", () => {
		const repository = join(import.meta.dir, "../..");
		const debt = debtList(repository, NESTING_DEBT);
		// The harnesses of packages/agents hold every line of rule (o) of today.
		for (const workspace of ["packages/agents", "packages/engine"]) {
			const lines = linesOf(debt, workspace);
			const problems = (nestingDebt: string[]) =>
				checkWorkspace(repository, workspace, {
					leafContracts: LEAF_CONTRACTS[workspace],
					nestingDebt,
				});
			expect(problems(lines)).toEqual([]);
			expect(problems([])).toHaveLength(lines.length);
		}
	}, 120_000);
});
