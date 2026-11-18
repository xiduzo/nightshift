/**
 * scripts/check-doc-paths.ts, on small docs and on this repository.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import {
	checkDocPaths,
	docPathProblems,
	livingDocs,
	pathMentions,
} from "./check-doc-paths";

const FILES = [
	"README.md",
	"lefthook.yml",
	"docs/guide.md",
	"docs/deploy/monitoring.md",
	"apps/web/src/features/runs/list/run-list.tsx",
	"apps/web/src/features/runs/index.ts",
	"packages/engine/src/graph/step/sleep.ts",
	"packages/flows/src/kits/git/kit.ts",
	"scripts/check-layers.ts",
];

const problemsOf = (
	docs: Record<string, string>,
	examples: Record<string, string> = {},
	ignored: (path: string) => boolean = () => false,
) => docPathProblems({ docs, files: FILES, examples, ignored });

describe("a mention", () => {
	test("is a path with a folder, without the point that ends a sentence", () => {
		const text =
			"Read `apps/web/src/router.tsx`. See (`graph/sleep.ts:12`), `context.ts`, `apps/...` and and/or.";
		expect(pathMentions(text).map((mention) => mention.path)).toEqual([
			"apps/web/src/router.tsx",
			"graph/sleep.ts",
			"and/or",
		]);
	});

	test("is not a package entry, a URL or a relative import", () => {
		const text =
			"`@nightshift/engine/run-status`, https://github.com/acme/app/blob/main/a.ts, `./editor/inspector`, `../adr/0001-x.md`";
		expect(pathMentions(text)).toEqual([]);
	});
});

describe("a path from the root", () => {
	test("fails when the repository has no such file or folder", () => {
		expect(
			problemsOf({
				"README.md": [
					"`apps/web/src/features/runs/list/run-list.tsx` and `apps/web/src/features/runs/`",
					"`apps/web/src/features/runs/components/run-list.tsx`",
					"`packages/engine/src/log/`",
				].join("\n"),
			}),
		).toEqual([
			"README.md:2 names `apps/web/src/features/runs/components/run-list.tsx`. The repository has no such file or folder.",
			"README.md:3 names `packages/engine/src/log`. The repository has no such file or folder.",
		]);
	});

	test("matches as a glob, and fails a glob that matches nothing", () => {
		expect(
			problemsOf({
				"lefthook.yml": [
					'        - "packages/flows/src/kits/**"',
					'        - "packages/flows/src/starters/**"',
					"      run: bun scripts/check-layers.ts",
					"`apps/web/src/features/<vertical>/index.ts`",
					"`packages/{engine,flows}/src`",
					"`scripts/check-*.ts`",
				].join("\n"),
			}),
		).toEqual([
			"lefthook.yml:2 names `packages/flows/src/starters/**`. The repository has no such file or folder.",
		]);
	});

	test("passes as a link from the folder of the doc", () => {
		expect(
			problemsOf({
				"docs/guide.md": "[Monitoring](deploy/monitoring.md)",
				"README.md": "[Monitoring](deploy/monitoring.md)",
			}),
		).toEqual([]);
	});

	test("passes when git ignores it", () => {
		const ignored = (path: string) => path === "apps/web/dist";
		expect(
			problemsOf(
				{ "README.md": "`apps/web/dist/*.js` and `apps/web/.env`" },
				{},
				ignored,
			),
		).toEqual([
			"README.md:1 names `apps/web/.env`. The repository has no such file or folder.",
		]);
	});
});

describe("a TypeScript file below a folder", () => {
	test("fails when no file ends with it", () => {
		expect(
			problemsOf({
				"docs/guide.md": [
					"`graph/step/sleep.ts` and `features/runs/list/run-list.tsx`",
					"`graph/sleep.ts`",
					"`nodes/<family>/<kind>.ts` and `kits/<kit>/kit.ts`",
				].join("\n"),
			}),
		).toEqual([
			"docs/guide.md:2 names `graph/sleep.ts`. No file of the repository ends with that path.",
			"docs/guide.md:3 names `nodes/<family>/<kind>.ts`. No file of the repository ends with that path.",
		]);
	});

	test("does not read a folder, a file name alone or another kind of file", () => {
		expect(
			problemsOf({
				"docs/guide.md":
					"`adapters/out/`, `context.ts`, `learnings/accepted/note.md`, `expo/fetch`",
			}),
		).toEqual([]);
	});
});

describe("the examples", () => {
	test("cover a path and what is below it", () => {
		expect(
			problemsOf(
				{
					"README.md":
						"`apps/web/src/components`, `docs/private/plan.md`, `application/ports.ts`",
				},
				{
					"apps/web/src/components": "must not exist",
					"docs/private": "an example project",
					"application/ports.ts": "a pattern",
				},
			),
		).toEqual([]);
	});

	test("fail when no doc names them any more", () => {
		expect(
			problemsOf(
				{ "README.md": "`scripts/check-layers.ts`" },
				{ "docs/private": "an example project" },
			),
		).toEqual([
			"scripts/check-doc-paths.ts: no doc needs the example `docs/private` any more. Remove it from EXAMPLES.",
		]);
	});
});

describe("the living docs", () => {
	test("leave out the records, the user guide and the code", () => {
		expect(
			livingDocs([
				"README.md",
				"AGENTS.md",
				"CODE_OF_CONDUCT.md",
				"lefthook.yml",
				".github/workflows/ci.yml",
				".github/ISSUE_TEMPLATE/BUG.md",
				"docs/glossary.md",
				"docs/steering/TECH.md",
				"docs/deploy/tunnel.md",
				"docs/adr/0001-x.md",
				"docs/research/mobile.md",
				"docs/wiki/Home.md",
				"packages/ui/README.md",
				"scripts/check-layers.ts",
			]),
		).toEqual([
			"README.md",
			"AGENTS.md",
			"lefthook.yml",
			".github/workflows/ci.yml",
			".github/ISSUE_TEMPLATE/BUG.md",
			"docs/glossary.md",
			"docs/steering/TECH.md",
		]);
	});
});

describe("the command", () => {
	test("it passes on this repository", () => {
		expect(checkDocPaths(join(import.meta.dir, ".."))).toEqual([]);
	});
});
