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

/** A package.json with these workspace dependencies. */
function pkg(name: string, deps: string[] = []): string {
	return JSON.stringify({
		name,
		dependencies: Object.fromEntries(deps.map((d) => [d, "workspace:*"])),
	});
}

/** A small layer map: base (0), core (1), and one app. */
const LAYERS: Record<string, Rule> = {
	"@demo/base": { layer: 0, mayImport: [] },
	"@demo/core": { layer: 1, mayImport: "lower" },
	app: { layer: 2, mayImport: ["@demo/core"] },
};
const OPTIONS: Options = { layers: LAYERS, apps: new Set(["app"]) };

describe("the layer map", () => {
	test("a dependency on a lower layer passes", () => {
		const root = repo({
			"packages/base/package.json": pkg("@demo/base", ["zod"]),
			"packages/core/package.json": pkg("@demo/core", ["@demo/base"]),
			"apps/app/package.json": pkg("app", ["@demo/core"]),
		});
		expect(checkLayers(root, OPTIONS)).toEqual({
			problems: [],
			workspaces: 3,
			used: [],
		});
	});

	test("a dependency on a higher layer fails", () => {
		const root = repo({
			"packages/base/package.json": pkg("@demo/base", ["@demo/core"]),
			"packages/core/package.json": pkg("@demo/core"),
		});
		expect(checkLayers(root, OPTIONS).problems).toEqual([
			'packages/base/package.json: "@demo/base" (layer 0) may not depend on "@demo/core" (layer 1). It may depend on: no other workspace.',
		]);
	});

	test("a dependency that the app's list leaves out fails", () => {
		const root = repo({
			"packages/base/package.json": pkg("@demo/base"),
			"apps/app/package.json": pkg("app", ["@demo/base"]),
		});
		expect(checkLayers(root, OPTIONS).problems).toEqual([
			'apps/app/package.json: "app" (layer 2) may not depend on "@demo/base" (layer 0). It may depend on: @demo/core.',
		]);
	});

	test("a dependency on an app fails", () => {
		const root = repo({
			"packages/core/package.json": pkg("@demo/core", ["app"]),
			"apps/app/package.json": pkg("app"),
		});
		expect(checkLayers(root, OPTIONS).problems).toEqual([
			'packages/core/package.json: "@demo/core" depends on the app "app". No workspace may depend on an app.',
		]);
	});

	test("a workspace without a layer fails", () => {
		const root = repo({
			"packages/new/package.json": pkg("@demo/new"),
		});
		expect(checkLayers(root, OPTIONS).problems).toEqual([
			'packages/new/package.json: "@demo/new" has no layer. Add it to section 1 of docs/steering/STRUCTURE.md and to LAYERS in scripts/check-layers.ts.',
		]);
	});

	test("an exception allows one dependency, and fails once it is not needed", () => {
		const exception = { from: "@demo/base", to: "@demo/core", why: "a test" };
		const options = { ...OPTIONS, exceptions: [exception] };
		const needed = repo({
			"packages/base/package.json": pkg("@demo/base", ["@demo/core"]),
			"packages/core/package.json": pkg("@demo/core"),
		});
		expect(checkLayers(needed, options)).toEqual({
			problems: [],
			workspaces: 2,
			used: [exception],
		});
		const fixed = repo({
			"packages/base/package.json": pkg("@demo/base"),
			"packages/core/package.json": pkg("@demo/core"),
		});
		expect(checkLayers(fixed, options).problems).toEqual([
			'scripts/check-layers.ts: the exception "@demo/base" -> "@demo/core" is not needed any more. Remove it.',
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
