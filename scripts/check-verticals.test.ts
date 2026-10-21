/**
 * Each rule of scripts/check-verticals.ts, on small workspaces written to a
 * temporary folder. A rule is proven by one tree that breaks it and one
 * that keeps it.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
	checkWorkspace,
	checkWorkspaces,
	isTest,
	type Options,
	workspacesOf,
} from "./check-verticals";

const roots: string[] = [];

afterAll(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** Writes `files` (path → source) to a new root and checks one workspace. */
function check(
	workspace: string,
	files: Record<string, string>,
	options: Options = {},
): string[] {
	const root = mkdtempSync(join(tmpdir(), "check-verticals-"));
	roots.push(root);
	for (const [path, text] of Object.entries(files)) {
		const full = join(root, workspace, path);
		mkdirSync(dirname(full), { recursive: true });
		writeFileSync(full, text);
	}
	return checkWorkspace(root, workspace, options);
}

const APP = "apps/demo";
const PKG = "packages/demo";

/** An app with one vertical whose barrel exports one name. */
const runs = {
	"src/features/runs/index.ts": 'export { RunList } from "./run-list";\n',
	"src/features/runs/run-list.ts":
		'import { format } from "./lib/format";\nexport const RunList = () => format("runs");\n',
	"src/features/runs/lib/format.ts":
		"export const format = (s: string) => s;\n",
};

describe("deep imports (a)", () => {
	test("an import through the barrel passes", () => {
		expect(
			check(APP, {
				...runs,
				"src/routes/runs.ts":
					'import { RunList } from "../features/runs";\nexport const page = RunList;\n',
			}),
		).toEqual([]);
	});

	test("an import past the barrel fails and names the barrel", () => {
		const problems = check(APP, {
			...runs,
			"src/routes/runs.ts":
				'import { RunList } from "../features/runs/run-list";\nexport const page = RunList;\n',
		});
		expect(problems).toHaveLength(2);
		expect(problems[0]).toContain("apps/demo/src/routes/runs.ts");
		expect(problems[0]).toContain("past the barrel of features/runs");
		expect(problems[0]).toContain('Import "../features/runs" instead');
		// The barrel export lost its only importer.
		expect(problems[1]).toContain('"RunList"');
	});

	test("the @/ alias of tsconfig.json resolves, comments and all", () => {
		const problems = check(APP, {
			...runs,
			"tsconfig.json":
				'{\n\t/* Bundler mode */\n\t"compilerOptions": { "paths": { "@/*": ["./src/*"] } }\n}\n',
			"src/routes/runs.ts":
				'import type { RunList } from "@/features/runs/run-list";\nimport { RunList as List } from "@/features/runs";\nexport type Page = typeof RunList;\nexport const page = List;\n',
		});
		expect(problems).toEqual([
			'apps/demo/src/routes/runs.ts: imports "@/features/runs/run-list" past the barrel of features/runs. Import "@/features/runs" instead.',
		]);
	});

	test("export … from and dynamic import() count as imports", () => {
		const problems = check(APP, {
			...runs,
			"src/main.ts":
				'export { format } from "./features/runs/lib/format";\nexport const load = () => import("./features/runs/run-list");\n',
		});
		expect(problems.filter((p) => p.includes("past the barrel"))).toHaveLength(
			2,
		);
	});

	test("inside a vertical, relative imports may reach any file", () => {
		// run-list.ts imports ./lib/format: no problem.
		expect(
			check(APP, {
				...runs,
				"src/main.ts":
					'import { RunList } from "./features/runs";\nexport default RunList;\n',
			}),
		).toEqual([]);
	});

	test("a test may deep-import", () => {
		expect(
			check(APP, {
				...runs,
				"src/main.ts":
					'import { RunList } from "./features/runs";\nexport default RunList;\n',
				"src/routes/runs.test.ts":
					'import { format } from "../features/runs/lib/format";\nformat("x");\n',
			}),
		).toEqual([]);
	});

	test("a leaf contract may be imported past the barrel", () => {
		const files = {
			...runs,
			"src/features/runs/index.ts":
				'export { RunList } from "./run-list";\nexport { RUN_LIMIT } from "./limits";\n',
			"src/features/runs/limits.ts": "export const RUN_LIMIT = 3;\n",
			"src/features/gates/index.ts":
				'import { RUN_LIMIT } from "../runs/limits";\nimport { RunList } from "../runs";\nexport const gate = [RUN_LIMIT, RunList];\n',
			"src/main.ts":
				'import { gate } from "./features/gates";\nimport { RUN_LIMIT } from "./features/runs";\nexport default [gate, RUN_LIMIT];\n',
		};
		expect(check(APP, files)[0]).toContain("past the barrel of features/runs");
		expect(
			check(APP, files, { leafContracts: { "features/runs": ["limits"] } }),
		).toEqual([]);
	});

	test("a peer port opens one direction, through one file only", () => {
		const files = {
			"src/a/index.ts": 'export { a } from "./a";\n',
			"src/a/a.ts": 'import { b } from "../b/port";\nexport const a = b;\n',
			"src/a/private.ts": "export const hidden = 1;\n",
			"src/b/index.ts": 'export { b } from "./b";\n',
			"src/b/b.ts": "export const b = 2;\n",
			"src/b/port.ts": 'export { b } from "./b";\n',
			"src/b/other.ts":
				'import { hidden } from "../a/private";\nexport const c = hidden;\n',
			"src/index.ts": 'export { a } from "./a";\nexport { b } from "./b";\n',
		};
		const ports = { peerPorts: { a: { b: "port" } } };
		const problems = check(PKG, files, ports);
		// a → b through the port passes. b → a/private still fails.
		expect(problems).toEqual([
			'packages/demo/src/b/other.ts: imports "../a/private" past the barrel of a. Import "../a" instead.',
		]);
		expect(check(PKG, files)).toContainEqual(
			'packages/demo/src/a/a.ts: imports "../b/port" past the barrel of b. Import "../b" instead.',
		);
	});

	test("a vertical without index.ts fails", () => {
		expect(
			check(PKG, {
				"src/graph/compile.ts": "export const compile = 1;\n",
				"src/index.ts": "export const x = 1;\n",
			}),
		).toEqual([
			'packages/demo/src/graph/: the vertical "graph" has no index.ts. Add a barrel that exports what other code uses.',
		]);
	});

	test("testing/ in a package is not a vertical", () => {
		expect(
			check(PKG, {
				"src/runs/index.ts": 'export { run } from "./run";\n',
				"src/runs/run.ts": "export const run = 1;\n",
				"src/index.ts": 'export { run } from "./runs";\n',
				"src/testing/index.ts":
					'export { run as fakeRun } from "../runs/run";\n',
			}),
		).toEqual([]);
	});
});

describe("barrel reachability (b)", () => {
	test("a name nobody outside imports fails", () => {
		expect(
			check(APP, {
				...runs,
				"src/features/runs/index.ts":
					'export { RunList } from "./run-list";\nexport { format } from "./lib/format";\nexport type Unused = string;\n',
				"src/main.ts":
					'import { RunList } from "./features/runs";\nexport default RunList;\n',
			}),
		).toEqual([
			'apps/demo/src/features/runs/index.ts: nothing outside features/runs imports "Unused", "format". Take them off the barrel.',
		]);
	});

	test("a test does not count as an importer", () => {
		expect(
			check(APP, {
				...runs,
				"src/main.test.ts":
					'import { RunList } from "./features/runs";\nRunList();\n',
			}),
		).toEqual([
			'apps/demo/src/features/runs/index.ts: nothing outside features/runs imports "RunList". Take it off the barrel.',
		]);
	});

	test("a test counts for a testing vertical", () => {
		expect(
			check(APP, {
				"src/shared/testing/index.ts": "export const fake = 1;\n",
				"src/main.test.ts": 'import { fake } from "./shared/testing";\nfake;\n',
			}),
		).toEqual([]);
	});

	test("export * in a barrel exports the names of its target", () => {
		const problems = check(APP, {
			...runs,
			"src/features/runs/index.ts":
				'export * from "./run-list";\nexport * from "./lib/format";\n',
			"src/main.ts":
				'import { RunList } from "./features/runs";\nexport default RunList;\n',
		});
		expect(problems).toEqual([
			'apps/demo/src/features/runs/index.ts: nothing outside features/runs imports "format". Take it off the barrel.',
		]);
	});

	test("a namespace import and a plain import() use every name", () => {
		const files = {
			...runs,
			"src/features/runs/index.ts":
				'export { RunList } from "./run-list";\nexport { format } from "./lib/format";\n',
		};
		expect(
			check(APP, {
				...files,
				"src/main.ts":
					'import * as runs from "./features/runs";\nexport default runs;\n',
			}),
		).toEqual([]);
		expect(
			check(APP, {
				...files,
				"src/main.ts": 'export const load = () => import("./features/runs");\n',
			}),
		).toEqual([]);
	});

	test("a destructured import() uses only its names", () => {
		expect(
			check(APP, {
				...runs,
				"src/features/runs/index.ts":
					'export { RunList } from "./run-list";\nexport { format } from "./lib/format";\n',
				"src/main.ts":
					'export async function load() {\n\tconst { RunList } = await import("./features/runs");\n\treturn RunList;\n}\n',
			}),
		).toEqual([
			'apps/demo/src/features/runs/index.ts: nothing outside features/runs imports "format". Take it off the barrel.',
		]);
	});

	test("a barrel that package.json exports is a public entry", () => {
		const files = {
			"src/migrate/index.ts": 'export { migrate } from "./migrate";\n',
			"src/migrate/migrate.ts": "export const migrate = 1;\n",
		};
		expect(
			check(PKG, {
				...files,
				"package.json": JSON.stringify({
					exports: { "./migrate": "./src/migrate/index.ts" },
				}),
			}),
		).toEqual([]);
		expect(check(PKG, files)).toEqual([
			'packages/demo/src/migrate/index.ts: nothing outside migrate imports "migrate". Take it off the barrel.',
		]);
	});

	test("a package root index counts as an importer", () => {
		expect(
			check(PKG, {
				"src/runs/index.ts": 'export { run } from "./run";\n',
				"src/runs/run.ts": "export const run = 1;\n",
				"src/index.ts": 'export { run } from "./runs";\n',
			}),
		).toEqual([]);
	});
});

describe("top-level layout (c)", () => {
	test("a kind bucket at the top of src/ fails, in an app and a package", () => {
		expect(
			check(APP, { "src/lib/format.ts": "export const f = 1;\n" }),
		).toEqual([
			'apps/demo/src/lib/: "lib" is a kind bucket. Move each file into the vertical that uses it (src/features/<vertical>/ or a named src/shared/<name>/).',
		]);
		const problems = check(PKG, {
			"src/utils/index.ts": "export const f = 1;\n",
			"src/index.ts": 'export { f } from "./utils";\n',
		});
		expect(problems).toEqual([
			'packages/demo/src/utils/: "utils" is a kind bucket. Move each file into the vertical that uses it (src/<vertical>/).',
		]);
	});

	test("a kind folder inside a vertical is fine", () => {
		expect(
			check(APP, {
				...runs,
				"src/features/runs/hooks/use-runs.ts": "export const useRuns = 1;\n",
				"src/main.ts":
					'import { RunList } from "./features/runs";\nexport default RunList;\n',
			}),
		).toEqual([]);
	});

	test("a loose file in shared/ fails", () => {
		expect(
			check(APP, {
				"src/shared/time.ts": "export const now = 1;\n",
			}),
		).toEqual([
			"apps/demo/src/shared/time.ts: a loose file in shared/. Put it in a named folder with a barrel (shared/<name>/index.ts).",
		]);
	});
});

describe("the command", () => {
	test("tests are told apart from production files", () => {
		expect(isTest("features/runs/run-list.test.tsx")).toBe(true);
		expect(isTest("test-support.ts")).toBe(true);
		expect(isTest("testing/fake.ts")).toBe(true);
		expect(isTest("graph/fixtures/flow.ts")).toBe(true);
		expect(isTest("features/runs/run-list.tsx")).toBe(false);
	});

	test("it passes on this repository", () => {
		const result = Bun.spawnSync([
			process.execPath,
			join(import.meta.dir, "check-verticals.ts"),
		]);
		expect(result.stderr.toString()).toBe("");
		expect(result.exitCode).toBe(0);
	});

	test("it stays fast on this repository", () => {
		// This guards against an accidental O(n²) (for example a parse per
		// import), not against a slow computer. So it measures the CPU time
		// of the check itself, in this process: other processes on a busy
		// computer (a build, other tests) do not count. The check takes
		// about 2 s of CPU on a laptop. A slip into O(n²) costs many
		// times that, so the bound is generous.
		const root = join(import.meta.dir, "..");
		const before = process.cpuUsage();
		expect(checkWorkspaces(root, workspacesOf(root))).toEqual([]);
		const { user, system } = process.cpuUsage(before);
		expect((user + system) / 1000).toBeLessThan(15_000);
	});

	test("every workspace is checked, except ui and config", () => {
		const root = join(import.meta.dir, "..");
		const found = workspacesOf(root);
		expect(found).toContain("apps/web");
		expect(found).toContain("packages/engine");
		expect(found).not.toContain("packages/ui");
		expect(found).not.toContain("packages/config");
		for (const workspace of found) {
			expect(
				Bun.file(join(root, workspace, "package.json")).size,
			).toBeGreaterThan(0);
		}
	});

	test("a new workspace is checked without a list to update", () => {
		const root = mkdtempSync(join(tmpdir(), "check-verticals-"));
		roots.push(root);
		for (const workspace of [
			"apps/new",
			"packages/new",
			"packages/ui",
			"packages/config",
		]) {
			mkdirSync(join(root, workspace), { recursive: true });
			writeFileSync(join(root, workspace, "package.json"), "{}");
		}
		// A folder without a package.json is not a workspace.
		mkdirSync(join(root, "packages/notes"), { recursive: true });
		expect(workspacesOf(root)).toEqual(["apps/new", "packages/new"]);
		expect(checkWorkspaces(root, ["packages/missing"])).toEqual([
			"packages/missing: is not a workspace.",
		]);
	});
});
