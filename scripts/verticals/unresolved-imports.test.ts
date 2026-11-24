/**
 * Rule (r) of scripts/check-verticals.ts: a relative or aliased import that
 * names no file.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";

import { NOT_CHECKED, workspacesOf } from "../check-verticals";
import { inWorkspace, removeTrees, writeTree } from "./test-support";
import { checkUnresolvedImports, gitEnv } from "./unresolved-imports";

afterAll(removeTrees);

const PKG = "packages/demo";

const check = (files: Record<string, string>) =>
	checkUnresolvedImports(writeTree(inWorkspace(PKG, files)), [PKG]);

const missing = (path: string, specifier: string) =>
	`${PKG}/${path}: imports "${specifier}", which names no file. Fix the path.`;

describe("a relative or aliased import names a file (r)", () => {
	for (const [form, line] of [
		["a value", 'import { a } from "./gone";'],
		["a type", 'import type { A } from "./gone";'],
		["a side effect", 'import "./gone";'],
		["a re-export", 'export { a } from "./gone";'],
		["a star export", 'export * from "./gone";'],
		["a dynamic import", 'export const a = () => import("./gone");'],
		["a written type", 'export type A = import("./gone").A;'],
		["a require", 'export const a = require("./gone");'],
	] as const) {
		test(`${form} fails, in source and in a test`, () => {
			expect(check({ "src/a.ts": `${line}\n` })).toEqual([
				missing("src/a.ts", "./gone"),
			]);
			expect(check({ "src/a.test.ts": `${line}\n` })).toEqual([
				missing("src/a.test.ts", "./gone"),
			]);
		});
	}

	test("an alias that names no file fails", () => {
		expect(
			check({
				"tsconfig.json": '{"compilerOptions":{"paths":{"@/*":["./src/*"]}}}',
				"src/a.ts": 'import "@/gone";\nimport "@/b";\nimport "zod";\n',
				"src/b.ts": "",
			}),
		).toEqual([missing("src/a.ts", "@/gone")]);
	});

	test("a file, a barrel, an asset, a platform file and a declaration pass", () => {
		expect(
			check({
				"src/a.ts": [
					'import "./b";',
					'import "./b.js";',
					'import "./c";',
					'import "./style.css?url";',
					'import "./phone";',
					'import "./types";',
				].join("\n"),
				"src/b.ts": "",
				"src/c/index.ts": "",
				"src/style.css": "",
				"src/phone.ios.tsx": "",
				"src/types.d.ts": "",
			}),
		).toEqual([]);
	});

	test("a generated file that git ignores passes", () => {
		const root = writeTree({
			".gitignore": "routeTree.gen.ts\n",
			...inWorkspace(PKG, {
				"src/a.ts": 'import "./routeTree.gen";\nimport "./gone";\n',
			}),
		});
		Bun.spawnSync(["git", "init", "-q"], { cwd: root, env: gitEnv() });
		expect(checkUnresolvedImports(root, [PKG])).toEqual([
			missing("src/a.ts", "./gone"),
		]);
	});

	test("every workspace of this repository passes", () => {
		const root = join(import.meta.dir, "../..");
		expect(
			checkUnresolvedImports(root, [...workspacesOf(root), ...NOT_CHECKED]),
		).toEqual([]);
	}, 60_000);
});
