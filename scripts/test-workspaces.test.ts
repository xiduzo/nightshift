/**
 * The list of workspaces that CI tests (scripts/test-workspaces.ts), on
 * small trees written to a temporary folder, and on this repository.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { runsInCi, testWorkspaces } from "./test-workspaces";

const roots: string[] = [];

afterAll(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** Writes `files` (path → source) to a new root and lists its workspaces. */
function list(files: Record<string, string>): string[] {
	const root = mkdtempSync(join(tmpdir(), "test-workspaces-"));
	roots.push(root);
	for (const [path, text] of Object.entries(files)) {
		const full = join(root, path);
		mkdirSync(dirname(full), { recursive: true });
		writeFileSync(full, text);
	}
	return testWorkspaces(root);
}

describe("test workspaces", () => {
	test("a workspace with a test is listed, without a test script", () => {
		expect(
			list({
				"apps/demo/package.json": "{}",
				"apps/demo/src/features/runs/runs.test.ts": "",
				"packages/core/package.json": '{"scripts":{"test":"bun test"}}',
				"packages/core/src/a.test.tsx": "",
			}),
		).toEqual(["apps/demo", "packages/core"]);
	});

	test("a workspace without a test that CI runs is not listed", () => {
		expect(
			list({
				"packages/plain/package.json": "{}",
				"packages/plain/src/index.ts": "",
				"packages/live/package.json": "{}",
				"packages/live/src/ollama.live.test.ts": "",
				"packages/deps/package.json": "{}",
				"packages/deps/node_modules/x/x.test.ts": "",
				"packages/built/package.json": "{}",
				"packages/built/dist/x.test.ts": "",
			}),
		).toEqual([]);
	});

	test("a folder without package.json is no workspace", () => {
		expect(list({ "packages/loose/a.test.ts": "" })).toEqual([]);
	});

	test("live tests do not run in CI", () => {
		expect(runsInCi("a.test.ts")).toBe(true);
		expect(runsInCi("a.test.tsx")).toBe(true);
		expect(runsInCi("a.live.test.ts")).toBe(false);
		expect(runsInCi("a.ts")).toBe(false);
	});

	test("this repository lists its tested workspaces", () => {
		const found = testWorkspaces(join(import.meta.dir, ".."));
		expect(found).toContain("apps/desktop");
		expect(found).toContain("packages/engine");
		expect(found).not.toContain("packages/config");
	});
});
