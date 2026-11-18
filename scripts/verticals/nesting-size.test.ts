/**
 * Rule (p) of scripts/check-verticals.ts: a vertical or a sub-vertical
 * over 25 source files or 5,000 lines consists of sub-verticals. One tree
 * breaks it and one keeps it, at each limit.
 */
import { afterAll, describe, expect, test } from "bun:test";

import { checkWorkspace } from "../check-verticals";
import {
	inWorkspace,
	longFile,
	removeTrees,
	sourceFiles,
	writeTree,
} from "./test-support";

afterAll(removeTrees);

const PKG = "packages/demo";

const check = (files: Record<string, string>) =>
	checkWorkspace(writeTree(inWorkspace(PKG, files)), PKG);

describe("a vertical over the limits consists of sub-verticals (p)", () => {
	/** The vertical `runs`: 20 files in its root, and `steps/` of `inSteps`. */
	const runs = (inSteps: Record<string, string>) => ({
		"src/index.ts": 'export { run } from "./runs";\n',
		"src/runs/index.ts": 'export { run } from "./run";\n',
		"src/runs/run.ts": "export const run = 1;\n",
		...sourceFiles("src/runs", 18),
		...inSteps,
	});
	const noBarrel = (
		folder: string,
		unit: string,
		size: string,
		kind = "vertical",
	) =>
		`packages/demo/src/${folder}/: has no index.ts. The ${kind} ${unit} holds ${size}, over the limit of 25 source files and 5000 lines (tests do not count). So each folder in it is a sub-vertical: add a barrel that exports what the rest of ${unit} uses.`;
	const ownCode = (folder: string, size: string, kind = "vertical") =>
		`packages/demo/src/${folder}/: the ${kind} ${folder} holds ${size} of its own, outside a sub-vertical. The limit is 25 source files and 5000 lines (tests do not count). Split it into sub-verticals by sub-domain: folders with their own index.ts.`;
	/** `steps/` as a sub-vertical that `run.ts` imports. */
	const stepsBarrel = {
		"src/runs/run.ts":
			'import { part0 } from "./steps";\nexport const run = part0;\n',
		"src/runs/steps/index.ts": 'export { part0 } from "./part-0";\n',
	};

	test("at the limit, a folder without a barrel is fine", () => {
		// 20 in the root and 5 in steps/: 25 source files.
		expect(check(runs(sourceFiles("src/runs/steps", 5)))).toEqual([]);
	});

	test("over 25 source files, a folder without an index.ts fails", () => {
		expect(check(runs(sourceFiles("src/runs/steps", 6)))).toEqual([
			noBarrel("runs/steps", "runs", "26 source files and 26 lines"),
		]);
	});

	test("with a barrel in each folder it passes", () => {
		expect(
			check({ ...runs(sourceFiles("src/runs/steps", 6)), ...stepsBarrel }),
		).toEqual([]);
	});

	test("over 5,000 lines, a folder without an index.ts fails", () => {
		const steps = (lines: number) =>
			runs({ "src/runs/steps/long.ts": longFile("long", lines) });
		// The root holds 20 files of one line each.
		expect(check(steps(4980))).toEqual([]);
		expect(check(steps(4981))).toEqual([
			noBarrel("runs/steps", "runs", "21 source files and 5001 lines"),
		]);
	});

	test("tests do not count, and a folder of tests needs no barrel", () => {
		expect(
			check({
				...runs(sourceFiles("src/runs/steps", 5)),
				...sourceFiles("src/runs/steps", 30, ".test.ts"),
				"src/runs/steps/long.test.ts": longFile("long", 6000),
			}),
		).toEqual([]);
		expect(
			check({
				...runs(sourceFiles("src/runs/steps", 6)),
				...stepsBarrel,
				"src/runs/fixtures/flow.ts": "export const flow = 1;\n",
				"src/runs/cases/run.test.ts": "export {};\n",
			}),
		).toEqual([]);
	});

	test("its own code stays within the limits: a flat vertical fails", () => {
		const flat = (extra: Record<string, string>) => ({
			"src/index.ts": 'export { run } from "./runs";\n',
			"src/runs/index.ts": 'export { run } from "./run";\n',
			"src/runs/run.ts": "export const run = 1;\n",
			...extra,
		});
		expect(check(flat(sourceFiles("src/runs", 23)))).toEqual([]);
		expect(check(flat(sourceFiles("src/runs", 24)))).toEqual([
			ownCode("runs", "26 source files and 26 lines"),
		]);
		expect(check(flat({ "src/runs/long.ts": longFile("long", 4998) }))).toEqual(
			[],
		);
		expect(check(flat({ "src/runs/long.ts": longFile("long", 4999) }))).toEqual(
			[ownCode("runs", "3 source files and 5001 lines")],
		);
	});

	test("the same test holds again for a sub-vertical", () => {
		// steps/ has a barrel. It holds 27 files, 6 of them in steps/retry/.
		const deep = {
			...runs(sourceFiles("src/runs/steps", 20)),
			...stepsBarrel,
			...sourceFiles("src/runs/steps/retry", 6),
		};
		expect(check(deep)).toEqual([
			noBarrel(
				"runs/steps/retry",
				"runs/steps",
				"27 source files and 27 lines",
				"sub-vertical",
			),
		]);
		expect(
			check({
				...deep,
				"src/runs/steps/part-1.ts":
					'import { part0 } from "./retry";\nexport const part1 = part0;\n',
				"src/runs/steps/retry/index.ts": 'export { part0 } from "./part-0";\n',
			}),
		).toEqual([]);
		// 26 files directly in steps/: its own code is over the limit.
		expect(
			check({ ...runs(sourceFiles("src/runs/steps", 25)), ...stepsBarrel }),
		).toEqual([
			ownCode("runs/steps", "26 source files and 26 lines", "sub-vertical"),
		]);
	});

	test("a ring folder needs no barrel, and its files are the vertical's own code", () => {
		const slice = (inDomain: number) => ({
			"src/index.ts": 'export { run } from "./runs";\n',
			"src/runs/index.ts": 'export { run } from "./application/run";\n',
			"src/runs/application/run.ts": "export const run = 1;\n",
			...sourceFiles("src/runs/domain", inDomain),
			...sourceFiles("src/runs/adapters", 2),
			...sourceFiles("src/runs/adapters/in", 2),
			...sourceFiles("src/runs/adapters/out", 4),
			...sourceFiles("src/runs/steps", 8),
			"src/runs/application/start.ts":
				'import { part0 } from "../steps";\nexport const start = part0;\n',
			"src/runs/steps/index.ts": 'export { part0 } from "./part-0";\n',
		});
		// 3 + 14 + 2 + 2 + 4 = 25 of its own, and 9 in the sub-vertical steps/.
		expect(check(slice(14))).toEqual([]);
		expect(check(slice(15))).toEqual([
			ownCode("runs", "26 source files and 27 lines"),
		]);
	});

	test("a folder in a ring folder is a folder of the vertical: it needs a barrel", () => {
		const slice = {
			...runs(sourceFiles("src/runs/domain", 4)),
			...sourceFiles("src/runs/adapters/http", 2),
		};
		expect(check(slice)).toEqual([
			noBarrel("runs/adapters/http", "runs", "26 source files and 26 lines"),
		]);
		expect(
			check({
				...slice,
				"src/runs/run.ts":
					'import { part0 } from "./adapters/http";\nexport const run = part0;\n',
				"src/runs/adapters/http/index.ts":
					'export { part0 } from "./part-0";\n',
			}),
		).toEqual([]);
	});
});
