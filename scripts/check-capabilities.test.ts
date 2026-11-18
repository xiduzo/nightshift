/**
 * Each rule of scripts/check-capabilities.ts, on small workspaces written
 * to a temporary folder. A rule is proven by one tree that breaks it and
 * one that keeps it.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { MECHANISM, WIRING } from "./capabilities";
import {
	type CapabilityMap,
	checkCapabilities,
	checkTables,
	debtOf,
	glossaryTerms,
	MAX_CAPABILITY_IMPORTS,
	verticalImports,
} from "./check-capabilities";
import { checkWorkspace } from "./check-verticals";

const roots: string[] = [];

afterAll(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const PKG = "packages/demo";
const APP = "apps/demo";
const M = MECHANISM;
const W = WIRING;

/** Writes `files` (path in the repository → source) to a new root. */
function tree(files: Record<string, string>): string {
	const root = mkdtempSync(join(tmpdir(), "check-capabilities-"));
	roots.push(root);
	const workspaces = new Set(
		Object.keys(files).map((path) => path.split("/").slice(0, 2).join("/")),
	);
	for (const workspace of workspaces)
		files[`${workspace}/package.json`] ??= "{}\n";
	for (const [path, text] of Object.entries(files)) {
		const full = join(root, path);
		mkdirSync(dirname(full), { recursive: true });
		writeFileSync(full, text);
	}
	return root;
}

/**
 * A package with one file per vertical. `imports` gives the verticals each
 * one imports: `{ runs: ["log"] }`.
 */
function pkg(
	verticals: string[],
	imports: Record<string, string[]> = {},
	workspace = PKG,
): Record<string, string> {
	const files: Record<string, string> = {};
	for (const vertical of verticals) {
		const up = vertical.includes("/") ? "../.." : "..";
		const lines = (imports[vertical] ?? []).map(
			(to, i) => `import { value as v${i} } from "${up}/${to}";`,
		);
		files[`${workspace}/src/${vertical}/index.ts`] =
			`${lines.join("\n")}\nexport const value = 1;\n`;
	}
	return files;
}

const map = (
	verticals: Record<string, string>,
	capabilities = ["runs", "gates", "flows"],
	workspace = PKG,
): CapabilityMap => ({ capabilities, verticals: { [workspace]: verticals } });

describe("the map and the disk (V1a)", () => {
	test("a map that names every vertical passes", () => {
		const root = tree(pkg(["runs", "log"]));
		expect(
			checkCapabilities(root, map({ runs: "runs", log: M }, ["runs"])),
		).toEqual([]);
	});

	test("a vertical that the map does not have fails", () => {
		const root = tree(pkg(["runs", "log"]));
		expect(checkCapabilities(root, map({ runs: "runs" }, ["runs"]))).toEqual([
			'packages/demo/src/log/: the vertical "log" is not on the capability map (V1a). Add it to "packages/demo" in VERTICALS of scripts/capabilities.ts, with its capability or MECHANISM.',
		]);
	});

	test("an entry of the map that is not on disk fails", () => {
		const root = tree(pkg(["runs"]));
		expect(
			checkCapabilities(root, map({ runs: "runs", log: M }, ["runs"])),
		).toEqual([
			'scripts/capabilities.ts: packages/demo has no vertical "log" (V1a). Remove it from VERTICALS, or write the name it has now.',
		]);
	});

	test("a workspace of the map that is not checked fails", () => {
		const root = tree(pkg(["runs"]));
		const problems = checkCapabilities(root, {
			capabilities: ["runs"],
			verticals: { [PKG]: { runs: "runs" }, "packages/ui": { button: M } },
		});
		expect(problems).toEqual([
			'scripts/capabilities.ts: "packages/ui" is not a checked workspace (V1a). Remove it from VERTICALS.',
		]);
	});

	test("a name that is no capability fails", () => {
		const root = tree(pkg(["runs", "log"]));
		const problems = checkCapabilities(
			root,
			map({ runs: "runs", log: "machinery" }, ["runs"]),
		);
		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain('"log" of packages/demo has "machinery"');
		expect(problems[0]).toContain(
			"Use a name of CAPABILITIES, MECHANISM or WIRING",
		);
	});

	test("a capability that no vertical has fails", () => {
		const root = tree(pkg(["runs"]));
		expect(
			checkCapabilities(root, map({ runs: "runs" }, ["runs", "gates"])),
		).toEqual([
			'scripts/capabilities.ts: no vertical has the capability "gates" (V1a). Remove it from its table, or give it to the vertical that holds it.',
		]);
	});

	test("a shared piece of an app is a mechanism", () => {
		const root = tree(pkg(["features/runs", "shared/gates"], {}, APP));
		const ok = map(
			{ "features/runs": "runs", "shared/gates": M },
			["runs"],
			APP,
		);
		expect(checkCapabilities(root, ok)).toEqual([]);
		const problems = checkCapabilities(
			root,
			map(
				{ "features/runs": "runs", "shared/gates": "gates" },
				["runs", "gates"],
				APP,
			),
		);
		expect(problems).toEqual([
			'scripts/capabilities.ts: "shared/gates" of apps/demo is a shared piece, and a shared piece is a mechanism (V1a). Write MECHANISM, or move the folder to features/gates/.',
		]);
	});

	test("a package's testing/ folder is no vertical", () => {
		const root = tree({
			...pkg(["runs"]),
			"packages/demo/src/testing/index.ts": "export const fake = 1;\n",
		});
		expect(checkCapabilities(root, map({ runs: "runs" }, ["runs"]))).toEqual(
			[],
		);
	});
});

describe("the folder has the name of its capability (V1b)", () => {
	const files = pkg(["runs", "read", "log"]);
	const named = map({ runs: "runs", read: "runs", log: M }, ["runs"]);

	test("a vertical under another name fails, and says where it goes", () => {
		expect(checkCapabilities(tree(files), named)).toEqual([
			'packages/demo/src/read/: the vertical is part of the capability "runs", but its folder is "read" (V1b). Name the folder "runs", or move it into packages/demo/src/runs/ as a sub-vertical.',
		]);
	});

	test("it passes while it is on the rename debt list", () => {
		expect(
			checkCapabilities(tree(files), named, "rename packages/demo read\n"),
		).toEqual([]);
	});

	test("a rename line fails once the folder has the name", () => {
		const root = tree(pkg(["runs", "log"]));
		expect(
			checkCapabilities(
				root,
				map({ runs: "runs", log: M }, ["runs"]),
				"rename packages/demo runs\nrename packages/demo read\n",
			),
		).toEqual([
			'scripts/capability-debt.txt: "rename packages/demo runs" is not needed any more (V1b). Remove the line.',
			'scripts/capability-debt.txt: "rename packages/demo read" is not needed any more (V1b). Remove the line.',
		]);
	});

	test("an app's vertical is named by its folder in features/", () => {
		const root = tree(pkg(["features/runs", "features/inbox"], {}, APP));
		const problems = checkCapabilities(
			root,
			map(
				{ "features/runs": "runs", "features/inbox": "gates" },
				["runs", "gates"],
				APP,
			),
		);
		expect(problems).toEqual([
			'apps/demo/src/features/inbox/: the vertical is part of the capability "gates", but its folder is "inbox" (V1b). Name the folder "gates", or move it into apps/demo/src/features/gates/ as a sub-vertical.',
		]);
	});

	test("a mechanism does not take the name of a capability", () => {
		const root = tree(pkg(["runs", "gates"]));
		const problems = checkCapabilities(
			root,
			map({ runs: "runs", gates: M }, ["runs", "gates"]),
		);
		expect(problems).toHaveLength(2);
		expect(problems[0]).toContain(
			'packages/demo/src/gates/: the mechanism "gates" has the name of the capability "gates" (V1b).',
		);
		expect(problems[1]).toContain('no vertical has the capability "gates"');
	});
});

describe("a mechanism imports no capability (V2)", () => {
	const verticals = { runs: "runs", gates: "gates", log: M, store: M };
	const two = ["runs", "gates"];

	test("a capability imports a mechanism, and a mechanism a mechanism", () => {
		const root = tree(
			pkg(["runs", "gates", "log", "store"], {
				runs: ["log", "gates"],
				log: ["store"],
			}),
		);
		expect(checkCapabilities(root, map(verticals, two))).toEqual([]);
	});

	test("a mechanism that imports a capability fails, and names the file", () => {
		const root = tree({
			...pkg(["runs", "gates", "log", "store"]),
			"packages/demo/src/log/events.ts":
				'import { value } from "../runs";\nexport const events = value;\n',
		});
		expect(checkCapabilities(root, map(verticals, two))).toEqual([
			'packages/demo/src/log/events.ts: the mechanism "log" imports the capability vertical "runs" (V2). A mechanism imports no capability: let its caller pass in what it needs, or move the rule into the capability.',
		]);
	});

	test("a type-only import counts, and so does a deep one", () => {
		const root = tree({
			...pkg(["runs", "gates", "log", "store"]),
			"packages/demo/src/runs/status.ts": "export type Status = string;\n",
			"packages/demo/src/log/events.ts":
				'import type { Status } from "../runs/status";\nexport type Event = { status: Status };\n',
		});
		const problems = checkCapabilities(root, map(verticals, two));
		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain("(V2)");
	});

	test("a test does not count", () => {
		const root = tree({
			...pkg(["runs", "gates", "log", "store"]),
			"packages/demo/src/log/events.test.ts":
				'import { value } from "../runs";\nexport const events = value;\n',
			"packages/demo/src/log/test-support.ts":
				'import { value } from "../gates";\nexport const events = value;\n',
		});
		expect(checkCapabilities(root, map(verticals, two))).toEqual([]);
	});

	test("it passes while the import is on the debt list", () => {
		const root = tree(
			pkg(["runs", "gates", "log", "store"], { log: ["runs"] }),
		);
		expect(
			checkCapabilities(
				root,
				map(verticals, two),
				"imports packages/demo log runs\n",
			),
		).toEqual([]);
	});

	test("one line is one pair: another capability still fails", () => {
		const root = tree(
			pkg(["runs", "gates", "log", "store"], { log: ["runs", "gates"] }),
		);
		const problems = checkCapabilities(
			root,
			map(verticals, two),
			"imports packages/demo log runs\n",
		);
		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain('imports the capability vertical "gates"');
	});

	test("an imports line fails once the import is gone", () => {
		const root = tree(pkg(["runs", "gates", "log", "store"]));
		expect(
			checkCapabilities(
				root,
				map(verticals, two),
				"imports packages/demo log runs\n",
			),
		).toEqual([
			'scripts/capability-debt.txt: "imports packages/demo log runs" is not needed any more (V2): the mechanism "log" does not import the capability vertical "runs". Remove the line.',
		]);
	});

	test("an imports line fails once the importer is a capability", () => {
		const root = tree(
			pkg(["runs", "gates", "log", "store"], { gates: ["runs"] }),
		);
		const problems = checkCapabilities(
			root,
			map(verticals, two),
			"imports packages/demo gates runs\n",
		);
		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain("is not needed any more (V2)");
	});
});

describe("the wiring piece composes the capabilities (decision 30)", () => {
	const names = ["a", "b", "c", "d", "e", "f"];
	const features = names.map((name) => `features/${name}`);
	const all = [...features, "shared/shell", "shared/api", "shared/frame"];
	const places = (shell: string, frame: string = M) => ({
		...Object.fromEntries(names.map((name) => [`features/${name}`, name])),
		"shared/shell": shell,
		"shared/api": M,
		"shared/frame": frame,
	});
	const check = (
		imports: Record<string, string[]>,
		verticals: Record<string, string>,
	) =>
		checkCapabilities(tree(pkg(all, imports, APP)), map(verticals, names, APP));

	test("it imports every capability: V2 and V5 do not apply", () => {
		expect(features.length).toBeGreaterThan(MAX_CAPABILITY_IMPORTS);
		expect(
			check({ "shared/shell": [...features, "shared/api"] }, places(W)),
		).toEqual([]);
	});

	test("the same shell as a mechanism fails V2, once per capability", () => {
		const problems = check({ "shared/shell": features }, places(M));
		expect(problems).toHaveLength(features.length);
		expect(problems[0]).toBe(
			'apps/demo/src/shared/shell/index.ts: the mechanism "shared/shell" imports the capability vertical "features/a" (V2). A mechanism imports no capability: let its caller pass in what it needs, or move the rule into the capability.',
		);
	});

	test("a mechanism beside the wiring piece still fails V2", () => {
		expect(
			check(
				{ "shared/shell": features, "shared/api": ["features/a"] },
				places(W),
			),
		).toEqual([
			'apps/demo/src/shared/api/index.ts: the mechanism "shared/api" imports the capability vertical "features/a" (V2). A mechanism imports no capability: let its caller pass in what it needs, or move the rule into the capability.',
		]);
	});

	test("a second wiring piece in one workspace fails", () => {
		expect(
			check(
				{ "shared/shell": features, "shared/frame": features },
				places(W, W),
			),
		).toEqual([
			'scripts/capabilities.ts: "shared/frame" of apps/demo has WIRING, and the wiring of an app is its shared/shell (V1a). Write MECHANISM. An app composes its features in shared/shell.',
		]);
	});

	test("a feature of an app is no wiring piece", () => {
		const inApp = check(
			{ "shared/shell": features },
			{ ...places(W), "features/a": W },
		);
		expect(inApp).toHaveLength(2);
		expect(inApp[0]).toContain('"features/a" of apps/demo has WIRING');
		expect(inApp[1]).toContain('no vertical has the capability "a"');
	});

	test("a wiring piece that composes nothing is a mechanism", () => {
		expect(check({ "shared/shell": ["shared/api"] }, places(W))).toEqual([
			'apps/demo/src/shared/shell/: the wiring piece "shared/shell" imports no capability vertical (V1a). A piece that composes nothing is a mechanism: write MECHANISM in scripts/capabilities.ts.',
		]);
		expect(check({ "shared/shell": ["shared/api"] }, places(M))).toEqual([]);
	});

	test("a capability does not count the wiring piece (V5)", () => {
		const root = tree(
			pkg(
				all,
				{
					"shared/shell": features,
					"features/a": [...features.slice(1), "shared/shell"],
				},
				APP,
			),
		);
		expect(checkCapabilities(root, map(places(W), names, APP))).toEqual([]);
	});

	test("no vertical imports it: rule (h) of the vertical check says so", () => {
		const root = tree({
			...pkg(
				all,
				{ "shared/shell": features, "features/a": ["shared/shell"] },
				APP,
			),
			"apps/demo/src/routes/index.ts":
				'import { value } from "../shared/shell";\nexport default value;\n',
		});
		// The route imports the piece too, and that is fine.
		const closed = checkWorkspace(root, APP, { entryDirs: ["routes"] }).filter(
			(problem) => problem.includes("imports shared/shell"),
		);
		expect(closed).toEqual([
			"apps/demo/src/features/a/index.ts: imports shared/shell, which composes the features. Only the routes and the app's entry files import it.",
		]);
	});
});

describe("the wiring piece of a package without rings (decision 53)", () => {
	const names = ["a", "b", "c", "d", "e", "f"];
	const all = [...names, "live", "api", "follow"];
	const places = (live: string, follow: string = M) => ({
		...Object.fromEntries(names.map((name) => [name, name])),
		live,
		api: M,
		follow,
	});
	const check = (
		imports: Record<string, string[]>,
		verticals: Record<string, string>,
		more: Record<string, string> = {},
		workspace = PKG,
	) =>
		checkCapabilities(
			tree({ ...pkg(all, imports, workspace), ...more }),
			map(verticals, names, workspace),
		);

	test("it imports every capability: V2 and V5 do not apply", () => {
		expect(names.length).toBeGreaterThan(MAX_CAPABILITY_IMPORTS);
		expect(check({ live: [...names, "api"] }, places(W))).toEqual([]);
	});

	test("the same vertical as a mechanism fails V2, once per capability", () => {
		const problems = check({ live: names }, places(M));
		expect(problems).toHaveLength(names.length);
		expect(problems[0]).toContain(
			'the mechanism "live" imports the capability vertical "a" (V2)',
		);
	});

	test("the entry file of the package imports it, and that is fine", () => {
		expect(
			check({ live: names }, places(W), {
				"packages/demo/src/index.ts":
					'export { value as live } from "./live";\n',
			}),
		).toEqual([]);
	});

	test("a capability that imports it fails", () => {
		expect(check({ live: names, a: ["live"] }, places(W))).toEqual([
			'packages/demo/src/a/index.ts: the vertical "a" imports "live", the wiring piece of packages/demo (V2). No vertical imports the wiring: only the entry files of the package do. Move what "a" needs into a vertical below both.',
		]);
	});

	test("a mechanism that imports it fails", () => {
		const problems = check({ live: names, api: ["live"] }, places(W));
		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain('the vertical "api" imports "live"');
	});

	test("a test that imports it fails too", () => {
		expect(
			check({ live: names }, places(W), {
				"packages/demo/src/a/a.test.ts":
					'import { value } from "../live";\nexport const used = value;\n',
			}),
		).toEqual([
			'packages/demo/src/a/a.test.ts: the vertical "a" imports "live", the wiring piece of packages/demo (V2). No vertical imports the wiring: only the entry files of the package do. Move what "a" needs into a vertical below both.',
		]);
	});

	test("its own test imports it, and that is fine", () => {
		expect(
			check({ live: names }, places(W), {
				"packages/demo/src/live/live.test.ts":
					'import { value } from "./index";\nexport const used = value;\n',
			}),
		).toEqual([]);
	});

	test("a second wiring piece in one package fails", () => {
		expect(check({ live: names, follow: names }, places(W, W))).toEqual([
			'scripts/capabilities.ts: "live" of packages/demo has WIRING, and so has "follow" (V1a). A workspace has at most one wiring piece. Write MECHANISM for the one that does not compose the capabilities.',
		]);
	});

	test("a wiring piece that composes nothing is a mechanism", () => {
		expect(check({ live: ["api"] }, places(W))).toEqual([
			'packages/demo/src/live/: the wiring piece "live" imports no capability vertical (V1a). A piece that composes nothing is a mechanism: write MECHANISM in scripts/capabilities.ts.',
		]);
	});

	test("a server package has none: it composes in a wire.ts", () => {
		expect(check({ live: names }, places(W), {}, "packages/engine")).toEqual([
			'scripts/capabilities.ts: "live" of packages/engine has WIRING, and a server package has no wiring piece (V1a). Write MECHANISM. A package with rings composes its slices in a wire.ts outside the verticals.',
		]);
		// As a mechanism, its imports are V2 problems, as before.
		expect(
			check({ live: names }, places(M), {}, "packages/engine"),
		).toHaveLength(names.length);
	});
});

describe("a capability imports few capabilities (V5)", () => {
	const names = ["a", "b", "c", "d", "e", "f", "g"];
	const all = ["runs", ...names, "log", "store"];
	const verticals = {
		runs: "runs",
		...Object.fromEntries(names.map((name) => [name, name])),
		log: M,
		store: M,
	};
	const wide = (imported: string[], debt = "") =>
		checkCapabilities(
			tree(pkg(all, { runs: imported })),
			map(verticals, ["runs", ...names]),
			debt,
		);

	test("the limit is 5", () => {
		expect(MAX_CAPABILITY_IMPORTS).toBe(5);
	});

	test("5 other capabilities pass, and mechanisms do not count", () => {
		expect(wide(["a", "b", "c", "d", "e", "log", "store"])).toEqual([]);
	});

	test("6 other capabilities fail, and the message names them", () => {
		expect(wide(["a", "b", "c", "d", "e", "f", "log"])).toEqual([
			'packages/demo/src/runs/: the capability vertical "runs" imports 6 other capability verticals (a, b, c, d, e, f), and the limit is 5 (V5). Let its caller pass in what it needs, or move the code that wires many into a wire.ts outside the verticals.',
		]);
	});

	test("a test does not count", () => {
		const root = tree({
			...pkg(all, { runs: ["a", "b", "c", "d", "e"] }),
			"packages/demo/src/runs/runs.test.ts":
				'import { value } from "../f";\nexport const used = value;\n',
		});
		expect(checkCapabilities(root, map(verticals, ["runs", ...names]))).toEqual(
			[],
		);
	});

	test("it passes while it is on the debt list with its count", () => {
		expect(
			wide(["a", "b", "c", "d", "e", "f"], "wide packages/demo runs 6\n"),
		).toEqual([]);
	});

	test("a lower count than the line passes, above the limit", () => {
		expect(
			wide(["a", "b", "c", "d", "e", "f"], "wide packages/demo runs 7\n"),
		).toEqual([]);
	});

	test("a count that goes up fails", () => {
		expect(
			wide(["a", "b", "c", "d", "e", "f", "g"], "wide packages/demo runs 6\n"),
		).toEqual([
			'packages/demo/src/runs/: the capability vertical "runs" imports 7 other capability verticals (a, b, c, d, e, f, g), and its debt line allows 6 (V5). The count only goes down: remove an import.',
		]);
	});

	test("a wide line fails once the vertical is at the limit", () => {
		expect(
			wide(["a", "b", "c", "d", "e"], "wide packages/demo runs 6\n"),
		).toEqual([
			'scripts/capability-debt.txt: "wide packages/demo runs 6" is not needed any more (V5): "runs" imports 5 other capability verticals. Remove the line.',
		]);
	});

	test("a wide line of a vertical that is gone fails", () => {
		const problems = wide(["a"], "wide packages/demo old 6\n");
		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain(
			'"old" is no capability vertical of packages/demo',
		);
	});
});

describe("the debt list", () => {
	test("it reads the three kinds of line, and skips comments", () => {
		const debt = debtOf(
			[
				"# A comment.",
				"rename packages/demo read",
				"imports  packages/demo log runs  # why",
				"wide packages/demo runs 9",
				"",
			].join("\n"),
		);
		expect(debt).toEqual({
			rename: [{ workspace: "packages/demo", vertical: "read" }],
			imports: [{ workspace: "packages/demo", from: "log", to: "runs" }],
			wide: [{ workspace: "packages/demo", vertical: "runs", count: 9 }],
			problems: [],
		});
	});

	test("a line it cannot read is a problem", () => {
		for (const line of [
			"packages/demo read",
			"rename packages/demo",
			"rename packages/demo read runs",
			"imports packages/demo log",
			"wide packages/demo runs",
			"wide packages/demo runs many",
		]) {
			const { problems } = debtOf(`${line}\n`);
			expect(problems).toHaveLength(1);
			expect(problems[0]).toContain(`"${line}" is not a debt line`);
		}
	});

	test("a line listed twice is a problem", () => {
		const { problems } = debtOf(
			"wide packages/demo runs 9\nwide packages/demo runs 8\n",
		);
		expect(problems).toEqual([
			'scripts/capability-debt.txt: "wide packages/demo runs 8" is listed twice. Remove one line.',
		]);
	});
});

describe("the tables of the map", () => {
	const glossary = [
		"| Term | Meaning | Source |",
		"|------|---------|--------|",
		"| Run | A walk of a Flow. | PLAN |",
		"| Agent Profile | A harness and a model. | PLAN |",
	].join("\n");

	test("the terms are the first cell of each row", () => {
		expect([...glossaryTerms(glossary)]).toEqual(["Run", "Agent Profile"]);
	});

	test("a word of the glossary passes", () => {
		expect(
			checkTables(glossary, {
				runs: { word: "Run" },
				agents: { word: "Agent Profile" },
			}),
		).toEqual([]);
	});

	test("a word the glossary does not have fails", () => {
		expect(checkTables(glossary, { glance: { word: "Glance" } })).toEqual([
			'scripts/capabilities.ts: the capability "glance" has the word "Glance", which is no term of docs/glossary.md (V1a). Use a term of the glossary.',
		]);
	});

	test("a name in two tables fails", () => {
		expect(
			checkTables(glossary, { runs: { word: "Run" } }, { runs: "Runs." }),
		).toEqual([
			'scripts/capabilities.ts: the capability "runs" is in two tables (V1a). Keep it in one.',
		]);
	});
});

describe("the imports between verticals", () => {
	test("it names one file per pair, and an alias resolves", () => {
		const root = tree({
			...pkg(["features/runs", "shared/api"], {}, APP),
			"apps/demo/tsconfig.json":
				'{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }\n',
			"apps/demo/src/features/runs/list.ts":
				'import { value } from "@/shared/api";\nexport const list = value;\n',
			"apps/demo/src/routes/runs.ts":
				'import { value } from "@/features/runs";\nexport const page = value;\n',
		});
		const { verticals, imports } = verticalImports(root, APP);
		expect(verticals.map((v) => v.name)).toEqual([
			"features/runs",
			"shared/api",
		]);
		expect([...imports.keys()]).toEqual(["features/runs"]);
		expect(imports.get("features/runs")?.get("shared/api")).toBe(
			join(root, "apps/demo/src/features/runs/list.ts"),
		);
	});
});

describe("the command", () => {
	test("it passes on this repository", () => {
		const result = Bun.spawnSync([
			process.execPath,
			join(import.meta.dir, "check-capabilities.ts"),
		]);
		expect(result.stderr.toString()).toBe("");
		expect(result.exitCode).toBe(0);
		expect(result.stdout.toString()).toContain("Capability check passed");
	}, 120_000);
});
