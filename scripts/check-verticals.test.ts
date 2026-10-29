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
	checkEntries,
	checkWorkspace,
	checkWorkspaces,
	type Options,
	workspacesOf,
} from "./check-verticals";

const roots: string[] = [];

afterAll(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/**
 * Writes `files` (path → source) to a new root and checks one workspace.
 * An app has `routes/` as its entry folder, like the web app.
 */
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
	return checkWorkspace(root, workspace, { entryDirs: ["routes"], ...options });
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

	test('require() and a type written as import("x").Name count as imports', () => {
		const problems = check(APP, {
			...runs,
			"src/main.ts":
				'export type List = import("./features/runs/run-list").RunList;\nexport const format = require("./features/runs/lib/format");\n',
		});
		expect(problems.filter((p) => p.includes("past the barrel"))).toEqual([
			'apps/demo/src/main.ts: imports "./features/runs/run-list" past the barrel of features/runs. Import "./features/runs" instead.',
			'apps/demo/src/main.ts: imports "./features/runs/lib/format" past the barrel of features/runs. Import "./features/runs" instead.',
		]);
	});

	test('import("x").Name through the barrel uses only that name', () => {
		expect(
			check(APP, {
				...runs,
				"src/features/runs/index.ts":
					'export { RunList } from "./run-list";\nexport { format } from "./lib/format";\n',
				"src/main.ts":
					'export type List = typeof import("./features/runs").RunList;\n',
			}),
		).toEqual([
			'apps/demo/src/features/runs/index.ts: nothing outside features/runs imports "format". Take it off the barrel.',
		]);
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
			"src/features/gates/index.ts": 'export { gate } from "./gate";\n',
			"src/features/gates/gate.ts":
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
					'export { RunList } from "./run-list";\nexport { format } from "./lib/format";\nexport type { Unused } from "./run-list";\n',
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
				"src/shared/testing/index.ts": 'export { fake } from "./fake";\n',
				"src/shared/testing/fake.ts": "export const fake = 1;\n",
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
			"src/utils/index.ts": 'export { f } from "./f";\n',
			"src/utils/f.ts": "export const f = 1;\n",
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

describe("imports that leave the workspace (d)", () => {
	test("a relative import out of the workspace fails, found or not", () => {
		expect(
			check(PKG, {
				"src/runs/index.ts": 'export { run } from "./run";\n',
				"src/runs/run.ts":
					'import { x } from "../../../agents/src/x";\nimport type { Y } from "../../../../apps/web/src/y";\nexport const run = [x] as Y[];\n',
				"src/index.ts": 'export { run } from "./runs";\n',
			}),
		).toEqual([
			'packages/demo/src/runs/run.ts: imports "../../../agents/src/x", a path outside packages/demo. Import the package by its name and an entry that its package.json exports.',
			'packages/demo/src/runs/run.ts: imports "../../../../apps/web/src/y", a path outside packages/demo. Import the package by its name and an entry that its package.json exports.',
		]);
	});

	test("a relative import inside the workspace passes", () => {
		expect(
			check(PKG, {
				"src/runs/index.ts": 'export { run } from "./run";\n',
				"src/runs/run.ts":
					'import { config } from "../../config";\nexport const run = config;\n',
				"config.ts": "export const config = 1;\n",
				"src/index.ts": 'export { run } from "./runs";\n',
			}),
		).toEqual([]);
	});
});

describe("the workspace's own name (e)", () => {
	const files = {
		"package.json": JSON.stringify({ name: "@demo/pkg" }),
		"src/runs/index.ts": 'export { run } from "./run";\n',
		"src/runs/run.ts": "export const run = 1;\n",
		"src/gates/index.ts": 'export { gate } from "./gate";\n',
		"src/index.ts":
			'export { run } from "./runs";\nexport { gate } from "./gates";\n',
	};

	test("an import of its own package name fails, in a test too", () => {
		expect(
			check(PKG, {
				...files,
				"src/gates/gate.ts":
					'import { run } from "@demo/pkg";\nexport const gate = run;\n',
				"src/gates/gate.test.ts":
					'import { fake } from "@demo/pkg/testing";\nfake;\n',
			}),
		).toEqual([
			'packages/demo/src/gates/gate.test.ts: imports its own package by name ("@demo/pkg/testing"). Import the file or the vertical\'s barrel by a relative path.',
			'packages/demo/src/gates/gate.ts: imports its own package by name ("@demo/pkg"). Import the file or the vertical\'s barrel by a relative path.',
		]);
	});

	test("another package's name passes", () => {
		expect(
			check(PKG, {
				...files,
				"src/gates/gate.ts":
					'import { z } from "@demo/pkg-two";\nexport const gate = z;\n',
			}),
		).toEqual([]);
	});
});

describe("tests stay out of production code (f)", () => {
	const files = {
		"src/runs/index.ts": 'export { run } from "./run";\n',
		"src/index.ts": 'export { run } from "./runs";\n',
		"src/runs/fixtures/flow.ts": "export const flow = 1;\n",
		"src/runs/test-support.ts": "export const support = 1;\n",
		"src/testing/index.ts": 'export { fake } from "./fake";\n',
		"src/testing/fake.ts": "export const fake = 1;\n",
	};

	test("production code that imports a fake, a fixture or a test helper fails", () => {
		expect(
			check(PKG, {
				...files,
				"src/runs/run.ts":
					'import { fake } from "../testing";\nimport { flow } from "./fixtures/flow";\nimport { support } from "./test-support";\nexport const run = [fake, flow, support];\n',
			}),
		).toEqual([
			'packages/demo/src/runs/run.ts: imports "../testing", which only tests may use (a test, a fake, a fixture or a test helper). Production code never imports it.',
			'packages/demo/src/runs/run.ts: imports "./fixtures/flow", which only tests may use (a test, a fake, a fixture or a test helper). Production code never imports it.',
			'packages/demo/src/runs/run.ts: imports "./test-support", which only tests may use (a test, a fake, a fixture or a test helper). Production code never imports it.',
		]);
	});

	test("a test may import them", () => {
		expect(
			check(PKG, {
				...files,
				"src/runs/run.ts": "export const run = 1;\n",
				"src/runs/run.test.ts":
					'import { fake } from "../testing";\nimport { flow } from "./fixtures/flow";\nimport { support } from "./test-support";\n[fake, flow, support];\n',
			}),
		).toEqual([]);
	});
});

describe("the top of an app's src/ (g)", () => {
	test("a folder other than features/, shared/ and the entry folder fails", () => {
		expect(
			check(APP, {
				"src/store/runs.ts": "export const runs = 1;\n",
				"src/routes/index.ts": "export const page = 1;\n",
				"src/router.tsx": "export const router = 1;\n",
			}),
		).toEqual([
			"apps/demo/src/store/: the top of an app's src/ holds only features/, shared/, routes/ and entry files. Move it into src/features/<vertical>/ or a named src/shared/<name>/.",
		]);
	});

	test("an entry folder is allowed only for its own app", () => {
		const files = { "src/routes/index.ts": "export const page = 1;\n" };
		expect(check(APP, files, { entryDirs: ["routes"] })).toEqual([]);
		expect(check(APP, files, { entryDirs: ["app"] })).toEqual([
			"apps/demo/src/routes/: the top of an app's src/ holds only features/, shared/, app/ and entry files. Move it into src/features/<vertical>/ or a named src/shared/<name>/.",
		]);
	});

	test("in a package, a folder at the top of src/ is a vertical", () => {
		expect(
			check(PKG, {
				"src/store/index.ts": 'export { store } from "./store";\n',
				"src/store/store.ts": "export const store = 1;\n",
				"src/index.ts": 'export { store } from "./store";\n',
			}),
		).toEqual([]);
	});
});

describe("the order of an app's shared pieces (h)", () => {
	const files = {
		...runs,
		"src/shared/shell/index.ts": 'export { AppShell } from "./app-shell";\n',
		"src/shared/shell/app-shell.ts":
			'import { RunList } from "../../features/runs";\nexport const AppShell = RunList;\n',
		"src/shared/format/index.ts": 'export { formatTime } from "./format";\n',
		"src/shared/format/format.ts": "export const formatTime = 1;\n",
		"src/routes/root.ts":
			'import { AppShell } from "../shared/shell";\nimport { formatTime } from "../shared/format";\nexport default [AppShell, formatTime];\n',
	};

	test("the shell imports features, and the routes import the shell", () => {
		expect(check(APP, files)).toEqual([]);
	});

	test("a shared piece that imports a feature fails, in a test too", () => {
		expect(
			check(APP, {
				...files,
				"src/shared/format/format.ts":
					'import { RunList } from "../../features/runs";\nexport const formatTime = RunList;\n',
				"src/shared/format/format.test.ts":
					'import { RunList } from "../../features/runs";\nRunList();\n',
			}),
		).toEqual([
			"apps/demo/src/shared/format/format.test.ts: the shared piece shared/format imports the feature features/runs. A shared piece imports no feature: let an entry file pass the feature's rule in (STRUCTURE.md section 5).",
			"apps/demo/src/shared/format/format.ts: the shared piece shared/format imports the feature features/runs. A shared piece imports no feature: let an entry file pass the feature's rule in (STRUCTURE.md section 5).",
		]);
	});

	test("a feature or a shared piece that imports the shell fails", () => {
		expect(
			check(APP, {
				...files,
				"src/features/gates/index.ts": 'export { Inbox } from "./inbox";\n',
				"src/features/gates/inbox.ts":
					'import { AppShell } from "../../shared/shell";\nexport const Inbox = AppShell;\n',
				"src/shared/format/format.ts":
					'import { AppShell } from "../shell";\nexport const formatTime = AppShell;\n',
				"src/routes/gates.ts":
					'import { Inbox } from "../features/gates";\nexport default Inbox;\n',
			}),
		).toEqual([
			"apps/demo/src/features/gates/inbox.ts: imports shared/shell, which composes the features. Only the routes and the app's entry files import it.",
			"apps/demo/src/shared/format/format.ts: imports shared/shell, which composes the features. Only the routes and the app's entry files import it.",
		]);
	});
});

describe("peer ports import only shared pieces (i)", () => {
	const files = {
		"src/shared/api/index.ts": 'export { orpc } from "./orpc";\n',
		"src/shared/api/orpc.ts": "export const orpc = 1;\n",
		"src/features/projects/index.ts":
			'export { Projects } from "./projects";\n',
		"src/features/projects/projects.ts": "export const Projects = 1;\n",
		"src/features/settings/index.ts":
			'export { settingsQueries } from "./queries";\nexport { SettingsPage } from "./settings-page";\n',
		"src/features/settings/settings-page.ts":
			'import { Projects } from "../projects";\nexport const SettingsPage = Projects;\n',
		"src/features/settings/types.ts": "export type Settings = { a: 1 };\n",
		"src/features/flows/index.ts": 'export { Editor } from "./editor";\n',
		"src/features/flows/editor.ts":
			'import { settingsQueries } from "../settings/queries";\nexport const Editor = settingsQueries;\n',
		"src/routes/index.ts":
			'import { Editor } from "../features/flows";\nimport { SettingsPage, settingsQueries } from "../features/settings";\nexport default [Editor, SettingsPage, settingsQueries];\n',
	};
	const ports = {
		peerPorts: { "features/flows": { "features/settings": "queries" } },
	};

	test("a port that imports shared pieces and its own vertical passes", () => {
		expect(
			check(
				APP,
				{
					...files,
					"src/features/settings/queries.ts":
						'import { orpc } from "../../shared/api";\nimport type { Settings } from "./types";\nexport const settingsQueries = orpc as unknown as Settings;\n',
				},
				ports,
			),
		).toEqual([]);
	});

	test("a port that imports another feature fails, through its own files too", () => {
		expect(
			check(
				APP,
				{
					...files,
					"src/features/settings/queries.ts":
						'import { orpc } from "../../shared/api";\nimport { more } from "./more";\nexport const settingsQueries = [orpc, more];\n',
					"src/features/settings/more.ts":
						'import { Projects } from "../projects";\nexport const more = Projects;\n',
				},
				ports,
			),
		).toEqual([
			'apps/demo/src/features/settings/more.ts: imports features/projects, but it is (or the peer port "features/settings/queries" reaches it). A peer port imports no other vertical than a shared piece, so it closes no cycle.',
		]);
	});

	test("a port that is not a file fails", () => {
		expect(
			check(APP, files, {
				peerPorts: { "features/flows": { "features/settings": "missing" } },
			}),
		).toContainEqual(
			'scripts/check-verticals.ts: the peer port "features/settings/missing" of features/flows is not a file of apps/demo. Fix or remove it.',
		);
	});
});

describe("the whole workspace", () => {
	const feeds = {
		"src/features/updates/index.ts":
			'export { startUpdates } from "./updates";\n',
		"src/features/updates/updates.ts":
			'import { FEEDS } from "./feeds";\nexport const startUpdates = () => FEEDS;\n',
		"src/features/updates/feeds.ts": "export const FEEDS = [1];\n",
		"src/main.ts":
			'import { startUpdates } from "./features/updates";\nstartUpdates();\n',
	};

	test("a config file outside src/ that deep-imports fails", () => {
		expect(
			check(APP, {
				...feeds,
				"build.config.ts":
					'import { FEEDS } from "./src/features/updates/feeds";\nexport default FEEDS;\n',
			}),
		).toEqual([
			'apps/demo/build.config.ts: imports "./src/features/updates/feeds" past the barrel of features/updates. Import "./src/features/updates" instead.',
		]);
	});

	test("the same file passes through a leaf contract", () => {
		expect(
			check(
				APP,
				{
					...feeds,
					"build.config.ts":
						'import { FEEDS } from "./src/features/updates/feeds";\nexport default FEEDS;\n',
				},
				{ leafContracts: { "features/updates": ["feeds"] } },
			),
		).toEqual([]);
	});

	test("a script outside src/ counts as an importer", () => {
		expect(
			check(APP, {
				...feeds,
				"src/main.ts": "export {};\n",
				"scripts/release.ts":
					'import { startUpdates } from "../src/features/updates";\nstartUpdates();\n',
			}),
		).toEqual([]);
	});

	test("a file in test/ is a test: it may deep-import, and it does not count", () => {
		expect(
			check(APP, {
				...feeds,
				"src/main.ts": "export {};\n",
				"test/updates.test.ts":
					'import { startUpdates } from "../src/features/updates";\nstartUpdates();\n',
				"test/daemons.ts":
					'import { FEEDS } from "../src/features/updates/feeds";\nexport const daemons = FEEDS;\n',
			}),
		).toEqual([
			'apps/demo/src/features/updates/index.ts: nothing outside features/updates imports "startUpdates". Take it off the barrel.',
		]);
	});

	test("installs, build output and dot folders are not read", () => {
		const deepImport =
			'import { FEEDS } from "../src/features/updates/feeds";\nexport default FEEDS;\n';
		expect(
			check(APP, {
				...feeds,
				"node_modules/x/index.ts": deepImport,
				"dist/index.ts": deepImport,
				".expo/types.ts": deepImport,
				"ios/widget.ts": deepImport,
			}),
		).toEqual([]);
	});
});

describe("leaf contracts and peer ports expire", () => {
	const files = {
		"src/runs/index.ts": 'export { run } from "./run";\n',
		"src/runs/run.ts": "export const run = 1;\n",
		"src/runs/limits.ts": "export const LIMIT = 3;\n",
		"src/gates/index.ts": 'export { gate } from "./gate";\n',
		"src/gates/gate.ts":
			'import { run } from "../runs";\nexport const gate = run;\n',
		"src/index.ts":
			'export { run } from "./runs";\nexport { gate } from "./gates";\n',
	};

	test("a leaf contract that nothing imports past the barrel fails", () => {
		expect(check(PKG, files, { leafContracts: { runs: ["limits"] } })).toEqual([
			'scripts/check-verticals.ts: nothing imports the leaf contract "runs/limits" past the barrel any more. Remove it from LEAF_CONTRACTS.',
		]);
	});

	test("a leaf contract that imports anything fails", () => {
		expect(
			check(
				PKG,
				{
					...files,
					"src/runs/limits.ts":
						'import { run } from "./run";\nexport const LIMIT = run;\n',
					"src/gates/gate.ts":
						'import { LIMIT } from "../runs/limits";\nexport const gate = LIMIT;\n',
				},
				{ leafContracts: { runs: ["limits"] } },
			),
		).toEqual([
			'packages/demo/src/runs/limits.ts: a leaf contract imports nothing, but it imports "./run".',
		]);
	});

	test("a leaf contract that is not a file fails", () => {
		expect(check(PKG, files, { leafContracts: { runs: ["gone"] } })).toEqual([
			'scripts/check-verticals.ts: the leaf contract "runs/gone" is not a file of packages/demo. Fix or remove it.',
		]);
	});

	test("a peer port that its vertical does not import fails", () => {
		expect(
			check(PKG, files, { peerPorts: { gates: { runs: "limits" } } }),
		).toEqual([
			'scripts/check-verticals.ts: gates does not import the peer port "runs/limits" any more. Remove it from PEER_PORTS.',
		]);
	});
});

describe("catch-all names (k)", () => {
	const files = {
		"src/runs/index.ts": 'export { run } from "./run";\n',
		"src/runs/run.ts": "export const run = 1;\n",
		"src/index.ts": 'export { run } from "./runs";\n',
	};

	test("a catch-all file name fails at any depth, its test too", () => {
		expect(
			check(PKG, {
				...files,
				"src/runs/utils.ts": "export const a = 1;\n",
				"src/runs/utils.test.ts": "export {};\n",
				"src/runs/graph/common.tsx": "export const b = 1;\n",
				"src/runs/shared.ts": "export const c = 1;\n",
				"scripts/helpers.ts": "export const d = 1;\n",
			}),
		).toEqual([
			'packages/demo/scripts/helpers.ts: "helpers" is a catch-all name. Name the file for what it holds, or move each part into the file that uses it.',
			'packages/demo/src/runs/graph/common.tsx: "common" is a catch-all name. Name the file for what it holds, or move each part into the file that uses it.',
			'packages/demo/src/runs/shared.ts: "shared" is a catch-all name. Name the file for what it holds, or move each part into the file that uses it.',
			'packages/demo/src/runs/utils.test.ts: "utils" is a catch-all name. Name the file for what it holds, or move each part into the file that uses it.',
			'packages/demo/src/runs/utils.ts: "utils" is a catch-all name. Name the file for what it holds, or move each part into the file that uses it.',
		]);
	});

	test("a catch-all folder fails at any depth, once", () => {
		expect(
			check(PKG, {
				...files,
				"src/runs/helpers/a.ts": "export const a = 1;\n",
				"src/runs/helpers/b.ts": "export const b = 1;\n",
				"src/runs/misc/util/c.ts": "export const c = 1;\n",
			}),
		).toEqual([
			'packages/demo/src/runs/helpers/: "helpers" is a catch-all folder. Name it for what it holds, or move each file into the folder that uses it.',
			'packages/demo/src/runs/misc/: "misc" is a catch-all folder. Name it for what it holds, or move each file into the folder that uses it.',
			'packages/demo/src/runs/misc/util/: "util" is a catch-all folder. Name it for what it holds, or move each file into the folder that uses it.',
		]);
	});

	test("a name for what the file holds passes, and so does an app's shared/", () => {
		expect(
			check(PKG, {
				...files,
				"src/runs/base.ts": "export const a = 1;\n",
				"src/runs/common-names.ts": "export const b = 1;\n",
			}),
		).toEqual([]);
		expect(
			check(APP, {
				"src/shared/time/index.ts": 'export { now } from "./now";\n',
				"src/shared/time/now.ts": "export const now = 1;\n",
				"src/main.ts": 'import { now } from "./shared/time";\nnow;\n',
			}),
		).toEqual([]);
	});
});

describe("no cycle between verticals (l)", () => {
	/** Three verticals: runs and gates import each other, log is below. */
	const files = {
		"src/runs/index.ts":
			'export { run } from "./run";\nexport type { Run } from "./run";\n',
		"src/runs/run.ts":
			'import type { Gate } from "../gates";\nimport { log } from "../log";\nexport type Run = { gate?: Gate };\nexport const run = log;\n',
		"src/gates/index.ts": 'export type { Gate } from "./gate";\n',
		"src/gates/gate.ts":
			'import type { Run } from "../runs";\nexport type Gate = { run: Run };\n',
		"src/log/index.ts": 'export { log } from "./log";\n',
		"src/log/log.ts": "export const log = 1;\n",
		"src/index.ts":
			'export { run, type Run } from "./runs";\nexport type { Gate } from "./gates";\n',
	};

	test("a cycle of type imports fails, and names the path", () => {
		expect(check(PKG, files)).toEqual([
			"packages/demo: the verticals gates, runs import each other: gates -> runs (packages/demo/src/gates/gate.ts) -> gates (packages/demo/src/runs/run.ts). Move what both need into the lower vertical, or cross through a peer port.",
		]);
	});

	test("an import through a peer port is not part of a cycle", () => {
		expect(
			check(
				PKG,
				{
					...files,
					"src/runs/run-type.ts": "export type RunId = string;\n",
					"src/gates/gate.ts":
						'import type { RunId } from "../runs/run-type";\nexport type Gate = { run: RunId };\n',
				},
				{ peerPorts: { gates: { runs: "run-type" } } },
			),
		).toEqual([]);
	});

	test("a test does not make a cycle", () => {
		expect(
			check(PKG, {
				...files,
				"src/gates/gate.ts": "export type Gate = { run: string };\n",
				"src/gates/gate.test.ts": 'import { run } from "../runs";\nrun;\n',
			}),
		).toEqual([]);
	});

	test("a known cycle skips the imports of its vertical, and fails once it is gone", () => {
		expect(check(PKG, files, { knownCycles: ["gates"] })).toEqual([]);
		expect(
			check(
				PKG,
				{
					...files,
					"src/gates/gate.ts": "export type Gate = { run: string };\n",
				},
				{ knownCycles: ["gates"] },
			),
		).toEqual([
			"scripts/check-verticals.ts: gates is in no cycle any more. Remove it from KNOWN_CYCLES, and its entry from STRUCTURE.md section 8.",
		]);
	});
});

describe("every value name on an entry has an importer (m)", () => {
	/**
	 * Writes `files` (path → source) to a new root and checks the entries of
	 * packages/demo. It exports a root and the barrel of migrate.
	 */
	const entries = (
		files: Record<string, string>,
		options: Parameters<typeof checkEntries>[2] = {},
	) => {
		const root = mkdtempSync(join(tmpdir(), "check-entries-"));
		roots.push(root);
		for (const [path, text] of Object.entries({
			"packages/demo/package.json": JSON.stringify({
				name: "@demo/pkg",
				exports: {
					".": "./src/index.ts",
					"./migrate": "./src/migrate/index.ts",
				},
			}),
			"packages/demo/src/migrate/index.ts":
				'export { migrate, migrationsFolder } from "./migrate";\n',
			"packages/demo/src/migrate/migrate.ts":
				"export const migrate = 1;\nexport const migrationsFolder = 2;\n",
			"packages/demo/src/runs/index.ts":
				'export { run, walk } from "./run";\nexport type { Run } from "./run";\n',
			"packages/demo/src/runs/run.ts":
				"export type Run = number;\nexport const run: Run = 1;\nexport const walk = 2;\n",
			"packages/demo/src/index.ts":
				'export { run, walk, type Run } from "./runs";\nexport { migrate } from "./migrate";\n',
			"apps/user/package.json": JSON.stringify({ name: "user" }),
			...files,
		})) {
			const full = join(root, path);
			mkdirSync(dirname(full), { recursive: true });
			writeFileSync(full, text);
		}
		return checkEntries(root, ["packages/demo"], {
			exceptions: [],
			pending: {},
			...options,
		});
	};
	const userImports = (text: string) => ({ "apps/user/src/main.ts": text });

	test("a name that no other workspace imports fails, a type too", () => {
		expect(
			entries(
				userImports(
					'import { walk } from "@demo/pkg";\nimport { migrate, migrationsFolder } from "@demo/pkg/migrate";\n[walk, migrate, migrationsFolder];\n',
				),
			),
		).toEqual([
			'packages/demo/src/index.ts: no other workspace imports "Run", "migrate", "run" from "@demo/pkg". Take them off the entry.',
		]);
	});

	test("a type stays when the declaration of a used name writes it, in turn", () => {
		const use = userImports(
			'import { run, walk } from "@demo/pkg";\nimport * as m from "@demo/pkg/migrate";\n[run, walk, m];\n',
		);
		const root = (runTs: string) => ({
			...use,
			"packages/demo/src/runs/index.ts":
				'export { run, walk } from "./run";\nexport type { Run, Step } from "./run";\n',
			"packages/demo/src/runs/run.ts": runTs,
			"packages/demo/src/index.ts":
				'export { run, walk, type Run, type Step } from "./runs";\nexport { migrate } from "./migrate";\n',
		});
		// run writes Run, Run writes Step: both stay.
		expect(
			entries(
				root(
					"export type Step = number;\nexport type Run = { steps: Step[] };\nexport function run(r: Run): number {\n\treturn r.steps.length;\n}\nexport const walk = 2;\n",
				),
			),
		).toEqual([
			'packages/demo/src/index.ts: no other workspace imports "migrate" from "@demo/pkg". Take it off the entry.',
		]);
		// Without a return type the body gives the type, so it counts. With
		// one, only the signature does.
		expect(
			entries(
				root(
					"export type Step = number;\nexport type Run = number;\nexport function run() {\n\treturn [] as Step[];\n}\nexport function walk(): number {\n\treturn 1 as Run;\n}\n",
				),
			),
		).toEqual([
			'packages/demo/src/index.ts: no other workspace imports "Run", "migrate" from "@demo/pkg". Take them off the entry.',
		]);
	});

	test("a test in another workspace counts only for a ./testing entry", () => {
		const testing = {
			"packages/demo/package.json": JSON.stringify({
				name: "@demo/pkg",
				exports: {
					".": "./src/index.ts",
					"./migrate": "./src/migrate/index.ts",
					"./testing": "./src/testing/index.ts",
				},
			}),
			"packages/demo/src/testing/index.ts":
				'export { fakeRun } from "./fake";\n',
			"packages/demo/src/testing/fake.ts": "export const fakeRun = 1;\n",
			...userImports(
				'import { run } from "@demo/pkg";\nimport * as migrate from "@demo/pkg/migrate";\n[run, migrate];\n',
			),
		};
		expect(
			entries({
				...testing,
				"apps/user/src/main.test.ts":
					'import { walk } from "@demo/pkg";\nimport { fakeRun } from "@demo/pkg/testing";\n[walk, fakeRun];\n',
			}),
		).toEqual([
			'packages/demo/src/index.ts: no other workspace imports "migrate" from "@demo/pkg". Take it off the entry.',
			'packages/demo/src/index.ts: only tests of other workspaces import "walk" from "@demo/pkg". Move it to "@demo/pkg/testing", or take it off the entry.',
		]);
		expect(
			entries({
				...testing,
				"apps/user/src/main.test.ts":
					'import * as demo from "@demo/pkg";\n[demo];\n',
			}),
		).toEqual([
			'packages/demo/src/index.ts: no other workspace imports "migrate", "walk" from "@demo/pkg". Take them off the entry.',
			'packages/demo/src/testing/index.ts: no other workspace imports "fakeRun" from "@demo/pkg/testing". Take it off the entry.',
		]);
	});

	test("a root re-export carries the use of its name through to the barrel", () => {
		expect(
			entries(
				userImports(
					'import * as demo from "@demo/pkg";\nimport { migrationsFolder } from "@demo/pkg/migrate";\n[demo, migrationsFolder];\n',
				),
			),
		).toEqual([]);
		expect(
			entries(
				userImports(
					'import { run, walk } from "@demo/pkg";\nimport { migrationsFolder } from "@demo/pkg/migrate";\n[run, walk, migrationsFolder];\n',
				),
			),
		).toEqual([
			'packages/demo/src/index.ts: no other workspace imports "migrate" from "@demo/pkg". Take it off the entry.',
			'packages/demo/src/migrate/index.ts: no other workspace imports "migrate" from "@demo/pkg/migrate". Take it off the entry.',
		]);
	});

	test("a production file of the package outside the barrel's vertical counts, a test does not", () => {
		const user = userImports(
			'import * as demo from "@demo/pkg";\nimport { migrate } from "@demo/pkg/migrate";\n[demo, migrate];\n',
		);
		expect(
			entries({
				...user,
				"packages/demo/src/runs/run.test.ts":
					'import { migrationsFolder } from "../migrate";\nmigrationsFolder;\n',
			}),
		).toEqual([
			'packages/demo/src/migrate/index.ts: no other workspace imports "migrationsFolder" from "@demo/pkg/migrate". Take it off the entry.',
		]);
		expect(
			entries({
				...user,
				"packages/demo/src/runs/run.ts":
					'import { migrationsFolder } from "../migrate";\nexport const run = migrationsFolder;\nexport const walk = 2;\nexport type Run = number;\n',
			}),
		).toEqual([]);
	});

	test("an exception skips an entry", () => {
		expect(
			entries(userImports('import { run } from "@demo/pkg";\nrun;\n'), {
				exceptions: ["@demo/pkg", "@demo/pkg/migrate"],
			}),
		).toEqual([]);
	});

	test("a pending name passes until a workspace imports it", () => {
		const pending = { pending: { "@demo/pkg": ["walk", "migrate"] } };
		const used =
			'import { run } from "@demo/pkg";\nimport * as m from "@demo/pkg/migrate";\n[run, m];\n';
		expect(entries(userImports(used), pending)).toEqual([]);
		expect(
			entries(
				userImports(`${used}import { walk } from "@demo/pkg";\nwalk;\n`),
				pending,
			),
		).toEqual([
			'scripts/check-verticals.ts: "walk" of "@demo/pkg" has an importer now. Remove it from PENDING_NAMES.',
		]);
	});
});

describe("barrels hold only imports and exports (j)", () => {
	test("a barrel with code fails, and so does a package's root index.ts", () => {
		expect(
			check(PKG, {
				"src/runs/index.ts":
					'import { run } from "./run";\nexport const runTwice = () => [run, run];\n',
				"src/runs/run.ts": "export const run = 1;\n",
				"src/index.ts":
					'import { runTwice } from "./runs";\nexport function start() {\n\treturn runTwice();\n}\n',
			}),
		).toEqual([
			"packages/demo/src/runs/index.ts: a barrel holds only import and export statements. Move the code into a file of runs and export it from there.",
			"packages/demo/src/index.ts: a barrel holds only import and export statements. Move the code into its vertical and export it from there.",
		]);
	});

	test("imports, re-exports, an export list and a default export pass", () => {
		expect(
			check(PKG, {
				"src/runs/index.ts":
					'import { run } from "./run";\nexport type { Run } from "./run";\nexport { run };\nexport default run;\n',
				"src/runs/run.ts":
					"export const run = 1;\nexport type Run = typeof run;\n",
				"src/index.ts":
					'export { default, run, type Run } from "./runs";\nexport * as runs from "./runs";\n',
			}),
		).toEqual([]);
	});
});

describe("the command", () => {
	// The two runs on the whole repository get the time a busy computer
	// needs: the default 5 s is wall time, and other processes count there.
	test("it passes on this repository", () => {
		const result = Bun.spawnSync([
			process.execPath,
			join(import.meta.dir, "check-verticals.ts"),
		]);
		expect(result.stderr.toString()).toBe("");
		expect(result.exitCode).toBe(0);
	}, 120_000);

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
	}, 120_000);

	test("every workspace is checked, except ui, ui-native and config", () => {
		const root = join(import.meta.dir, "..");
		const found = workspacesOf(root);
		expect(found).toContain("apps/web");
		expect(found).toContain("packages/engine");
		expect(found).not.toContain("packages/ui");
		expect(found).not.toContain("packages/ui-native");
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
			"packages/ui-native",
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
