/**
 * Each rule of scripts/check-capabilities.ts, on small workspaces written
 * to a temporary folder. A rule is proven by one tree that breaks it and
 * one that keeps it.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { MECHANISM } from "./capabilities";
import {
	type CapabilityMap,
	checkCapabilities,
	checkTables,
	debtOf,
	glossaryTerms,
	MAX_CAPABILITY_IMPORTS,
	verticalImports,
} from "./check-capabilities";

const roots: string[] = [];

afterAll(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const PKG = "packages/demo";
const APP = "apps/demo";
const M = MECHANISM;

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
		expect(problems[0]).toContain("Use a name of CAPABILITIES, or MECHANISM");
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
