/**
 * Rule (q) of scripts/check-verticals.ts: a source file of a vertical that
 * no production file of its workspace imports. One tree keeps the rule,
 * and one tree per case breaks it or shows what counts as an import.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";

import { checkWorkspaces } from "../check-verticals";
import { inWorkspace, removeTrees, writeTree } from "./test-support";
import { checkUnusedFiles } from "./unused-files";

afterAll(removeTrees);

const APP = "apps/demo";
const PKG = "packages/demo";

/** An app with one vertical whose every file has an importer. */
const app = (more: Record<string, string> = {}): Record<string, string> => ({
	"src/main.ts":
		'import { RunList } from "./features/runs";\nexport default RunList;\n',
	"src/features/runs/index.ts": 'export { RunList } from "./run-list";\n',
	"src/features/runs/run-list.ts":
		'import { rowLabel } from "./row";\nexport const RunList = rowLabel;\n',
	"src/features/runs/row.ts": "export const rowLabel = 1;\n",
	...more,
});

const check = (files: Record<string, string>, workspace = APP) =>
	checkUnusedFiles(writeTree(inWorkspace(workspace, files)), workspace);

const unused = (path: string, byTest = false) =>
	`${path}: no production file imports it${byTest ? ", only a test does" : ""}. Remove it${byTest ? " with its test" : ""}, or import it where it is used.`;

describe("a source file has a production importer (q)", () => {
	test("a vertical whose every file is imported passes", () => {
		expect(check(app())).toEqual([]);
	});

	test("a file that nothing imports fails", () => {
		expect(
			check(
				app({ "src/features/runs/day-label.ts": "export const day = 1;\n" }),
			),
		).toEqual([unused("apps/demo/src/features/runs/day-label.ts")]);
	});

	test("a file that only its test imports fails, and the message says so", () => {
		expect(
			check(
				app({
					"src/features/runs/day-label.ts": "export const day = 1;\n",
					"src/features/runs/day-label.test.ts":
						'import { day } from "./day-label";\nexport const used = day;\n',
				}),
			),
		).toEqual([unused("apps/demo/src/features/runs/day-label.ts", true)]);
	});

	test("a type-only import counts", () => {
		expect(
			check(
				app({
					"src/features/runs/row.ts":
						'import type { Day } from "./day";\nexport const rowLabel: Day = 1;\n',
					"src/features/runs/day.ts": "export type Day = number;\n",
				}),
			),
		).toEqual([]);
	});

	test("a route, an entry file and a config file count as importers", () => {
		expect(
			check(
				app({
					"src/features/runs/index.ts":
						'export { RunList } from "./run-list";\nexport { RunPage } from "./run-page";\nexport { feeds } from "./feeds";\n',
					"src/features/runs/run-page.ts": "export const RunPage = 1;\n",
					"src/features/runs/feeds.ts": "export const feeds = 1;\n",
					"src/routes/run.ts":
						'import { RunPage } from "../features/runs";\nexport default RunPage;\n',
					"build.config.ts":
						'import { feeds } from "./src/features/runs";\nexport default feeds;\n',
				}),
			),
		).toEqual([]);
	});

	test("an import of one platform file counts for its siblings", () => {
		const header = {
			"src/features/runs/run-list.ts":
				'import { rowLabel } from "./row";\nimport { Header } from "./run-header";\nexport const RunList = [rowLabel, Header];\n',
			"src/features/runs/run-header.tsx": "export const Header = 1;\n",
			"src/features/runs/run-header.android.tsx": "export const Header = 2;\n",
			"src/features/runs/run-header.ios.tsx": "export const Header = 3;\n",
		};
		expect(check(app(header))).toEqual([]);
		// Without the import, each of them fails.
		expect(
			check(
				app({
					...header,
					"src/features/runs/run-list.ts":
						'import { rowLabel } from "./row";\nexport const RunList = rowLabel;\n',
				}),
			),
		).toEqual([
			unused("apps/demo/src/features/runs/run-header.android.tsx"),
			unused("apps/demo/src/features/runs/run-header.ios.tsx"),
			unused("apps/demo/src/features/runs/run-header.tsx"),
		]);
	});

	test("a file that a script of package.json runs counts as imported", () => {
		const files = app({
			"src/features/runs/migrate.ts": "export const done = 1;\n",
		});
		expect(check(files)).toEqual([
			unused("apps/demo/src/features/runs/migrate.ts"),
		]);
		expect(
			check({
				...files,
				"package.json": JSON.stringify({
					scripts: { migrate: "bun src/features/runs/migrate.ts" },
				}),
			}),
		).toEqual([]);
	});

	test("an entry of a package counts as imported", () => {
		const files = {
			"src/index.ts": 'export { run } from "./runs";\n',
			"src/runs/index.ts": 'export { run } from "./run";\n',
			"src/runs/run.ts": "export const run = 1;\n",
			"src/runs/facts.ts": "export const facts = 1;\n",
		};
		expect(check(files, PKG)).toEqual([
			unused("packages/demo/src/runs/facts.ts"),
		]);
		expect(
			check(
				{
					...files,
					"package.json": JSON.stringify({
						name: "@nightshift/demo",
						exports: {
							".": "./src/index.ts",
							"./facts": "./src/runs/facts.ts",
						},
					}),
				},
				PKG,
			),
		).toEqual([]);
	});

	test("tests, test helpers and fixtures are not checked", () => {
		expect(
			check(
				app({
					"src/features/runs/run-list.test.ts":
						'import { RunList } from "./run-list";\nimport { sample } from "./fixtures/sample";\nimport { helper } from "./test-support";\nexport const used = [RunList, sample, helper];\n',
					"src/features/runs/fixtures/sample.ts": "export const sample = 1;\n",
					"src/features/runs/test-support.ts": "export const helper = 1;\n",
				}),
			),
		).toEqual([]);
	});

	test("a file outside a vertical is not checked", () => {
		expect(
			check(app({ "src/routes/alone.ts": "export default 1;\n" })),
		).toEqual([]);
	});

	test("the command runs the rule", () => {
		const root = writeTree(
			inWorkspace(APP, {
				...app({ "src/features/runs/day-label.ts": "export const day = 1;\n" }),
				"package.json": "{}\n",
			}),
		);
		expect(checkWorkspaces(root, [APP])).toEqual([
			unused("apps/demo/src/features/runs/day-label.ts"),
		]);
	});

	test("it passes on this repository: the platform files, and a file a script runs", () => {
		const root = join(import.meta.dir, "../..");
		for (const workspace of ["apps/mobile", "apps/server", "packages/client"])
			expect(checkUnusedFiles(root, workspace)).toEqual([]);
	});
});
