/**
 * Each rule of scripts/check-layers.ts, on small repositories written to a
 * temporary folder. A rule is proven by one tree that breaks it and one
 * that keeps it.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { checkLayers, type Options, type Rule } from "./check-layers";

const roots: string[] = [];

afterAll(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** Writes `files` (path → source) to a new root. */
function repo(files: Record<string, string>): string {
	const root = mkdtempSync(join(tmpdir(), "check-layers-"));
	roots.push(root);
	for (const [path, text] of Object.entries(files)) {
		const full = join(root, path);
		mkdirSync(dirname(full), { recursive: true });
		writeFileSync(full, text);
	}
	return root;
}

/**
 * A workspace at `dir`: its package.json with these workspace dependencies
 * and entries, and a source file that imports each dependency.
 */
function workspace(
	dir: string,
	name: string,
	deps: string[] = [],
	exports?: Record<string, string>,
): Record<string, string> {
	return {
		[`${dir}/package.json`]: JSON.stringify({
			name,
			exports,
			dependencies: Object.fromEntries(deps.map((d) => [d, "workspace:*"])),
		}),
		[`${dir}/src/index.ts`]: deps
			.map((d) => `import "${d}";\n`)
			.concat("export const ok = 1;\n")
			.join(""),
	};
}

/** A small layer map: base (0), core (1), and one app. */
const LAYERS: Record<string, Rule> = {
	"@demo/base": { layer: 0, mayImport: [] },
	"@demo/core": { layer: 1, mayImport: "lower" },
	app: { layer: 2, mayImport: ["@demo/core"] },
};
const OPTIONS: Options = {
	layers: LAYERS,
	apps: new Set(["app"]),
	entryExceptions: [],
	lightEntries: {},
};

describe("the layer map (L1)", () => {
	test("a dependency on a lower layer passes", () => {
		const root = repo({
			...workspace("packages/base", "@demo/base", [], {
				".": "./src/index.ts",
			}),
			...workspace("packages/core", "@demo/core", ["@demo/base"], {
				".": "./src/index.ts",
			}),
			...workspace("apps/app", "app", ["@demo/core"]),
		});
		expect(checkLayers(root, OPTIONS)).toEqual({
			problems: [],
			workspaces: 3,
			used: [],
		});
	});

	test("a dependency on a higher layer fails", () => {
		const root = repo({
			...workspace("packages/base", "@demo/base", ["@demo/core"]),
			...workspace("packages/core", "@demo/core"),
		});
		expect(checkLayers(root, OPTIONS).problems).toEqual([
			'packages/base/package.json: "@demo/base" (layer 0) may not depend on "@demo/core" (layer 1). It may depend on: no other workspace.',
		]);
	});

	test("a dependency that the app's list leaves out fails", () => {
		const root = repo({
			...workspace("packages/base", "@demo/base"),
			...workspace("apps/app", "app", ["@demo/base"]),
		});
		expect(checkLayers(root, OPTIONS).problems).toEqual([
			'apps/app/package.json: "app" (layer 2) may not depend on "@demo/base" (layer 0). It may depend on: @demo/core.',
		]);
	});

	test("a dependency on an app fails", () => {
		const root = repo({
			...workspace("packages/core", "@demo/core", ["app"]),
			...workspace("apps/app", "app"),
		});
		expect(checkLayers(root, OPTIONS).problems).toEqual([
			'packages/core/package.json: "@demo/core" depends on the app "app". No workspace may depend on an app.',
		]);
	});

	test("a workspace without a layer fails", () => {
		const root = repo(workspace("packages/new", "@demo/new"));
		expect(checkLayers(root, OPTIONS).problems).toEqual([
			'packages/new/package.json: "@demo/new" has no layer. Add it to section 1 of docs/steering/STRUCTURE.md and to LAYERS in scripts/check-layers.ts.',
		]);
	});

	test("an exception allows one dependency, and fails once it is not needed", () => {
		const exception = { from: "@demo/base", to: "@demo/core", why: "a test" };
		const options = { ...OPTIONS, exceptions: [exception] };
		const needed = repo({
			...workspace("packages/base", "@demo/base", ["@demo/core"]),
			...workspace("packages/core", "@demo/core"),
		});
		expect(checkLayers(needed, options)).toEqual({
			problems: [],
			workspaces: 2,
			used: [exception],
		});
		const fixed = repo({
			...workspace("packages/base", "@demo/base"),
			...workspace("packages/core", "@demo/core"),
		});
		expect(checkLayers(fixed, options).problems).toEqual([
			'scripts/check-layers.ts: the exception "@demo/base" -> "@demo/core" is not needed any more. Remove it.',
		]);
	});
});

describe("every dependency is used (L2)", () => {
	test("a declared workspace dependency that no file imports fails", () => {
		const root = repo({
			...workspace("packages/base", "@demo/base"),
			"packages/core/package.json": JSON.stringify({
				name: "@demo/core",
				dependencies: { "@demo/base": "workspace:*", zod: "^4" },
			}),
			"packages/core/src/index.ts": "export const ok = 1;\n",
		});
		expect(checkLayers(root, OPTIONS).problems).toEqual([
			'packages/core/package.json: "@demo/core" declares "@demo/base", but no file imports it. Remove the dependency.',
		]);
	});

	test("an import of any entry, a CSS import and a tsconfig extends count", () => {
		const root = repo({
			...workspace("packages/base", "@demo/base"),
			...workspace("packages/core", "@demo/core"),
			"apps/app/package.json": JSON.stringify({
				name: "app",
				dependencies: {
					"@demo/base": "workspace:*",
					"@demo/core": "workspace:*",
					"@demo/config": "workspace:*",
				},
			}),
			"apps/app/src/main.ts":
				'import type {\n\tRun,\n} from "@demo/core/types";\nexport type R = Run;\n',
			"apps/app/src/index.css": '@import "@demo/base/globals.css";\n',
			"apps/app/tsconfig.json":
				'{ "extends": ["@demo/config/tsconfig.base.json"] }\n',
			...workspace("packages/config", "@demo/config"),
		});
		const options = {
			...OPTIONS,
			layers: {
				...LAYERS,
				"@demo/config": { layer: 0, mayImport: [] },
				app: { layer: 2, mayImport: "lower" as const },
			},
		};
		expect(checkLayers(root, options).problems).toEqual([]);
	});
});

describe("every entry has an importer (L3)", () => {
	const files = {
		...workspace("packages/base", "@demo/base", [], {
			".": "./src/index.ts",
			"./testing": "./src/testing/index.ts",
			"./lib/*": "./src/lib/*.ts",
		}),
		"packages/base/src/testing/index.ts": "export const fake = 1;\n",
		...workspace("packages/core", "@demo/core", ["@demo/base"]),
	};

	test("an entry that no other workspace imports fails", () => {
		expect(checkLayers(repo(files), OPTIONS).problems).toEqual([
			'packages/base/package.json: no other workspace imports the entry "@demo/base/testing". Remove it from exports.',
		]);
	});

	test("a test in another workspace counts, and its own tests do not", () => {
		const own = {
			...files,
			"packages/base/src/a.test.ts": 'import "@demo/base/testing";\n',
		};
		expect(checkLayers(repo(own), OPTIONS).problems).toHaveLength(1);
		expect(
			checkLayers(
				repo({
					...own,
					"packages/core/src/core.test.ts":
						'import { fake } from "@demo/base/testing";\nfake;\n',
				}),
				OPTIONS,
			).problems,
		).toEqual([]);
	});

	test("an exception allows one entry, and fails once another workspace imports it", () => {
		const exception = { entry: "@demo/base/testing", why: "a test" };
		const options = { ...OPTIONS, entryExceptions: [exception] };
		expect(checkLayers(repo(files), options)).toEqual({
			problems: [],
			workspaces: 2,
			used: [exception],
		});
		expect(
			checkLayers(
				repo({
					...files,
					"packages/core/src/core.test.ts": 'import "@demo/base/testing";\n',
				}),
				options,
			).problems,
		).toEqual([
			'scripts/check-layers.ts: @demo/core imports "@demo/base/testing" now. Remove its exception.',
		]);
	});
});

describe("an entry points at a barrel (L4)", () => {
	const entry = (target: string, light: Record<string, string> = {}) =>
		checkLayers(
			repo({
				...workspace("packages/base", "@demo/base", [], {
					".": "./src/index.ts",
					"./files": "./src/files.ts",
					"./types": target,
				}),
				...workspace("packages/core", "@demo/core", ["@demo/base"]),
				"packages/core/src/use.ts":
					'import "@demo/base/files";\nimport "@demo/base/types";\n',
			}),
			{ ...OPTIONS, lightEntries: light },
		).problems;

	test("the root, a file in src/ and a barrel one folder down pass", () => {
		expect(entry("./src/types.ts")).toEqual([]);
		expect(entry("./src/port/index.ts")).toEqual([]);
	});

	test("a file past a barrel fails", () => {
		expect(entry("./src/port/types.ts")).toEqual([
			'packages/base/package.json: the entry "@demo/base/types" points at ./src/port/types.ts, past a barrel. Point it at src/index.ts, a file directly in src/, or a barrel one folder down (src/<vertical>/index.ts).',
		]);
	});

	test("a light entry may point deep, and fails once it does not", () => {
		const light = { "@demo/base/types": "a test" };
		expect(entry("./src/port/types.ts", light)).toEqual([]);
		expect(entry("./src/port/index.ts", light)).toEqual([
			'scripts/check-layers.ts: "@demo/base/types" points at ./src/port/index.ts, which an entry may name. Remove it from LIGHT_ENTRIES.',
		]);
	});

	test("a light entry that no package.json has fails", () => {
		expect(
			entry("./src/types.ts", {
				"@demo/base/types": "a test",
				"@demo/base/gone": "a test",
			}),
		).toContainEqual(
			'scripts/check-layers.ts: "@demo/base/gone" is not an entry of a package.json any more. Remove it from LIGHT_ENTRIES.',
		);
	});
});

describe("biome's allow-lists name every entry (L5)", () => {
	const biome = (listed: string[]) =>
		JSON.stringify({
			linter: {
				rules: {
					style: {
						noRestrictedImports: {
							options: {
								patterns: [
									{
										group: ["@demo/**", ...listed.map((e) => `!${e}`)],
										message: "Import a package by an entry in its exports.",
									},
									{ group: ["@demo/base"], message: "Not here." },
								],
							},
						},
					},
				},
			},
		});
	const files = {
		...workspace("packages/base", "@demo/base", [], {
			".": "./src/index.ts",
		}),
		...workspace("packages/core", "@demo/core", ["@demo/base"]),
	};

	test("a list with every entry passes", () => {
		expect(
			checkLayers(
				repo({ ...files, "biome.json": biome(["@demo/base"]) }),
				OPTIONS,
			).problems,
		).toEqual([]);
	});

	test("a list that lacks an entry, or names one that is gone, fails", () => {
		expect(
			checkLayers(
				repo({ ...files, "biome.json": biome(["@demo/base/old"]) }),
				OPTIONS,
			).problems,
		).toEqual([
			'biome.json: the allow-list at linter.rules.style.noRestrictedImports.options.patterns[0] lacks "!@demo/base". Every list names every entry.',
			'biome.json: the allow-list at linter.rules.style.noRestrictedImports.options.patterns[0] names "!@demo/base/old", which no package.json exports. Remove it.',
		]);
	});
});

describe("the command", () => {
	test("it passes on this repository", () => {
		const result = Bun.spawnSync([
			process.execPath,
			join(import.meta.dir, "check-layers.ts"),
		]);
		expect(result.stderr.toString()).toBe("");
		expect(result.exitCode).toBe(0);
	}, 60_000);
});
