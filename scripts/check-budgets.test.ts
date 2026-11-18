/**
 * Each rule of scripts/check-budgets.ts, on small workspaces written to a
 * temporary folder. A rule is proven by one tree that breaks it and one
 * that keeps it. The last test runs the check on this repository.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
	BARREL_WIDTH,
	checkBudgets,
	FILE_SIZE,
	FOLDER_SIZE,
	GENERATED,
	type Lists,
	linesOf,
	newPeerPorts,
	PEER_PORT_LIST,
	peerPortPairs,
	scopesOf,
	tightened,
} from "./check-budgets";

const roots: string[] = [];

afterAll(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const PKG = "packages/demo";
const APP = "apps/demo";
const NO_DEBT: Lists = { size: "", folder: "", barrel: "", peerPorts: "" };

/** A file of `count` lines, as `wc -l` counts them. */
const lines = (count: number) => "// a line\n".repeat(count);

/** A barrel that exports `count` values of `./names`, and that file. */
function barrelOf(count: number): Record<string, string> {
	const names = Array.from({ length: count }, (_, i) => `name${i}`);
	return {
		"index.ts": `export { ${names.join(", ")} } from "./names";\n`,
		"names.ts": names.map((name) => `export const ${name} = 1;\n`).join(""),
	};
}

/** `files` with `prefix` before each path. */
const under = (prefix: string, files: Record<string, string>) =>
	Object.fromEntries(
		Object.entries(files).map(([path, text]) => [`${prefix}/${path}`, text]),
	);

/** Writes `files` (path from the root → source) to a new root. */
function tree(files: Record<string, string>): string {
	const root = mkdtempSync(join(tmpdir(), "check-budgets-"));
	roots.push(root);
	for (const workspace of [PKG, APP])
		files[`${workspace}/package.json`] ??= '{ "name": "@demo/demo" }\n';
	for (const [path, text] of Object.entries(files)) {
		const full = join(root, path);
		mkdirSync(dirname(full), { recursive: true });
		writeFileSync(full, text);
	}
	return root;
}

/** The problems of every scope of a new root with `files`. */
function check(
	files: Record<string, string>,
	lists: Partial<Lists> = {},
	options: Parameters<typeof checkBudgets>[3] = {},
): string[] {
	const root = tree(files);
	return checkBudgets(
		root,
		scopesOf(root),
		{ ...NO_DEBT, ...lists },
		{ peerPorts: {}, ...options },
	);
}

describe("file size", () => {
	test("a file of 600 lines passes", () => {
		expect(check({ [`${PKG}/src/runs/run.ts`]: lines(600) })).toEqual([]);
	});

	test("a file of 601 lines fails, with the number, the limit and the fix", () => {
		expect(check({ [`${PKG}/src/runs/run.ts`]: lines(601) })).toEqual([
			"packages/demo/src/runs/run.ts: 601 lines, and the limit is 600 (file size). Split the file by sub-domain.",
		]);
	});

	test("it reads src/ and scripts/ of a workspace, and the scripts of the repository", () => {
		const problems = check({
			[`${APP}/src/features/runs/page.tsx`]: lines(601),
			[`${APP}/scripts/build.ts`]: lines(602),
			"scripts/check.ts": lines(603),
			[`${APP}/test/long.ts`]: lines(700),
			[`${APP}/app.config.ts`]: lines(700),
		});
		expect(problems.map((problem) => problem.split(":")[0])).toEqual([
			"apps/demo/scripts/build.ts",
			"apps/demo/src/features/runs/page.tsx",
			"scripts/check.ts",
		]);
	});

	test("a test, a declaration file and a generated file do not count", () => {
		expect(
			check(
				{
					[`${PKG}/src/runs/run.test.ts`]: lines(700),
					[`${PKG}/src/runs/run.live.test.ts`]: lines(700),
					[`${PKG}/src/runs/page.test.tsx`]: lines(700),
					[`${PKG}/src/runs/global.d.ts`]: lines(700),
					[`${PKG}/src/runs/schema.gen.ts`]: lines(700),
				},
				{},
				{ generated: ["packages/demo/src/runs/schema.gen.ts"] },
			),
		).toEqual([]);
	});

	test("a fake and a fixture count: they are not tests here", () => {
		const problems = check({
			[`${PKG}/src/testing/fake-engine.ts`]: lines(601),
			[`${PKG}/src/runs/fixtures/run.ts`]: lines(601),
		});
		expect(problems).toHaveLength(2);
	});

	test("a generated file is listed by its path, not by a pattern", () => {
		const problems = check(
			{ [`${PKG}/src/other/schema.gen.ts`]: lines(601) },
			{},
			{ generated: ["packages/demo/src/runs/schema.gen.ts"] },
		);
		expect(problems).toHaveLength(1);
	});

	test("the lines are the lines of `wc -l`", () => {
		const count = (text: string) => linesOf(new TextEncoder().encode(text));
		expect(count("")).toBe(0);
		expect(count("a\nb\n")).toBe(2);
		// A last line without a newline does not count.
		expect(count("a\nb")).toBe(1);
		expect(count("a\r\nb\r\n")).toBe(2);
	});
});

describe("folder size", () => {
	const files = (count: number) =>
		Object.fromEntries(
			Array.from({ length: count }, (_, i) => [
				`${PKG}/src/runs/file-${i}.ts`,
				"export {};\n",
			]),
		);

	test("25 source files pass. Tests and sub-folders do not count", () => {
		expect(
			check({
				...files(25),
				[`${PKG}/src/runs/file-0.test.ts`]: "export {};\n",
				[`${PKG}/src/runs/file-1.test.tsx`]: "export {};\n",
				[`${PKG}/src/runs/types.d.ts`]: "export {};\n",
				[`${PKG}/src/runs/README.md`]: "Runs.\n",
				[`${PKG}/src/runs/steps/step.ts`]: "export {};\n",
			}),
		).toEqual([]);
	});

	test("26 source files fail, with the number, the limit and the fix", () => {
		expect(check(files(26))).toEqual([
			"packages/demo/src/runs: 26 source files, and the limit is 25 (folder size). Move the files of one sub-domain into a sub-folder.",
		]);
	});

	test("a generated file does not count", () => {
		expect(
			check(
				{ ...files(25), [`${PKG}/src/runs/schema.gen.ts`]: "export {};\n" },
				{},
				{ generated: ["packages/demo/src/runs/schema.gen.ts"] },
			),
		).toEqual([]);
	});
});

describe("barrel width", () => {
	test("a barrel of 30 names of its own passes", () => {
		expect(check(under(`${PKG}/src/runs`, barrelOf(30)))).toEqual([]);
	});

	test("a barrel of 31 names of its own fails, with the number, the limit and the fix", () => {
		expect(check(under(`${PKG}/src/runs`, barrelOf(31)))).toEqual([
			"packages/demo/src/runs/index.ts: 31 names of its own, and the limit is 30 (barrel width). Split the vertical into sub-verticals by sub-domain (a name counts on the barrel of its sub-vertical), or take names off the barrel.",
		]);
	});

	test("an app's verticals are in features/ and shared/", () => {
		const problems = check({
			...under(`${APP}/src/features/runs`, barrelOf(31)),
			...under(`${APP}/src/shared/api`, barrelOf(32)),
		});
		expect(problems.map((problem) => problem.split(",")[0])).toEqual([
			"apps/demo/src/features/runs/index.ts: 31 names of its own",
			"apps/demo/src/shared/api/index.ts: 32 names of its own",
		]);
	});

	test("a type and a value both count", () => {
		const names = Array.from({ length: 16 }, (_, i) => `Name${i}`);
		const problems = check({
			[`${PKG}/src/runs/index.ts`]: `export { ${names.join(", ")} } from "./names";\nexport type { ${names.map((name) => `${name}Type`).join(", ")} } from "./names";\n`,
			[`${PKG}/src/runs/names.ts`]: names
				.map(
					(name) =>
						`export const ${name} = 1;\nexport type ${name}Type = number;\n`,
				)
				.join(""),
		});
		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain("32 names of its own");
	});

	test("a namespace counts as one name", () => {
		const { "index.ts": barrel, "names.ts": names } = barrelOf(29);
		expect(
			check({
				[`${PKG}/src/runs/index.ts`]: `${barrel}export * as wide from "./wide";\n`,
				[`${PKG}/src/runs/names.ts`]: names as string,
				[`${PKG}/src/runs/wide.ts`]: barrelOf(40)["names.ts"] as string,
			}),
		).toEqual([]);
	});

	test("`export *` counts every name it passes on", () => {
		const problems = check({
			[`${PKG}/src/runs/index.ts`]: 'export * from "./names";\n',
			[`${PKG}/src/runs/names.ts`]: barrelOf(31)["names.ts"] as string,
		});
		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain("31 names of its own");
	});

	test("an index.ts in a folder below a vertical counts, at any depth", () => {
		const problems = check({
			[`${PKG}/src/runs/index.ts`]: "export {};\n",
			...under(`${PKG}/src/runs/steps/agent`, barrelOf(31)),
			...under(`${PKG}/src/runs/steps`, barrelOf(30)),
		});
		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain(
			"packages/demo/src/runs/steps/agent/index.ts: 31 names of its own",
		);
	});

	test("a package's root index.ts and an entry of `exports` are not in scope", () => {
		expect(
			check({
				[`${PKG}/package.json`]:
					'{ "name": "@demo/demo", "exports": { ".": "./src/index.ts", "./contract": "./src/contract/index.ts" } }\n',
				...under(`${PKG}/src`, barrelOf(31)),
				...under(`${PKG}/src/contract`, barrelOf(31)),
			}),
		).toEqual([]);
	});
});

describe("peer ports", () => {
	const ports = {
		"apps/demo": {
			"features/gates": { "features/runs": "queries" },
			"features/flows": { "features/runs": "flows-port" },
		},
	};
	const frozen =
		"# Frozen.\napps/demo features/flows features/runs\napps/demo features/gates features/runs\n";

	test("the pairs of PEER_PORTS, sorted", () => {
		expect(peerPortPairs(ports)).toEqual([
			"apps/demo features/flows features/runs",
			"apps/demo features/gates features/runs",
		]);
	});

	test("the listed pairs pass", () => {
		expect(check({}, { peerPorts: frozen }, { peerPorts: ports })).toEqual([]);
	});

	test("a new pair fails, with the number and the limit", () => {
		const more = {
			"apps/demo": {
				...ports["apps/demo"],
				"features/runs": { "features/projects": "queries" },
			},
		};
		expect(check({}, { peerPorts: frozen }, { peerPorts: more })).toEqual([
			`scripts/check-verticals.ts: the peer port from features/runs to features/projects in apps/demo is new: 3 peer ports, and ${PEER_PORT_LIST} allows the 2 it lists (peer ports). Add no peer port. Move what both verticals need into the lower one, or let an entry file pass it in.`,
		]);
	});

	test("the other direction of a listed pair is a new pair", () => {
		const back = {
			"apps/demo": {
				...ports["apps/demo"],
				"features/runs": { "features/gates": "queries" },
			},
		};
		expect(check({}, { peerPorts: frozen }, { peerPorts: back })).toHaveLength(
			1,
		);
	});

	test("a listed pair that is gone fails: remove its line", () => {
		const fewer = {
			"apps/demo": { "features/gates": { "features/runs": "queries" } },
		};
		expect(check({}, { peerPorts: frozen }, { peerPorts: fewer })).toEqual([
			`${PEER_PORT_LIST}: apps/demo features/flows features/runs is not in PEER_PORTS any more (peer ports). Remove its line.`,
		]);
	});

	test("a line that is not a workspace and two verticals fails", () => {
		expect(newPeerPorts([], "apps/demo features/runs\n")).toEqual([
			`${PEER_PORT_LIST}:1: "apps/demo features/runs" is not an entry. Write a workspace and two verticals.`,
		]);
	});
});

describe("the debt lists", () => {
	const long = { [`${PKG}/src/runs/run.ts`]: lines(700) };

	test("a listed file at its number, or under it, passes", () => {
		const size = "# Long files.\npackages/demo/src/runs/run.ts 700\n";
		expect(check(long, { size })).toEqual([]);
		expect(check({ [`${PKG}/src/runs/run.ts`]: lines(650) }, { size })).toEqual(
			[],
		);
	});

	test("a listed file that grows fails", () => {
		expect(
			check(long, { size: "packages/demo/src/runs/run.ts 699\n" }),
		).toEqual([
			"packages/demo/src/runs/run.ts: 700 lines, and scripts/size-debt.txt allows 699 (file size, the limit is 600). A listed entry only shrinks. Split the file by sub-domain.",
		]);
	});

	test("a new offender fails beside a listed one", () => {
		const problems = check(
			{ ...long, [`${PKG}/src/runs/fresh.ts`]: lines(601) },
			{ size: "packages/demo/src/runs/run.ts 700\n" },
		);
		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain("packages/demo/src/runs/fresh.ts: 601 lines");
	});

	test("a listed file that is within the limit fails: remove its line", () => {
		expect(
			check(
				{ [`${PKG}/src/runs/run.ts`]: lines(600) },
				{ size: "packages/demo/src/runs/run.ts 700\n" },
			),
		).toEqual([
			"scripts/size-debt.txt: packages/demo/src/runs/run.ts has 600 lines, within the limit of 600 (file size). Remove its line.",
		]);
	});

	test("a listed file that is gone fails: remove its line", () => {
		expect(check({}, { size: "packages/demo/src/runs/run.ts 700\n" })).toEqual([
			"scripts/size-debt.txt: packages/demo/src/runs/run.ts is not a source file (file size). Remove its line.",
		]);
	});

	test("a line that is not a path and a number fails, and so does a double", () => {
		expect(
			check(long, {
				size: "packages/demo/src/runs/run.ts\npackages/demo/src/runs/run.ts 700\npackages/demo/src/runs/run.ts 700\n",
			}),
		).toEqual([
			'scripts/size-debt.txt:1: "packages/demo/src/runs/run.ts" is not an entry. Write a path and a number.',
			"scripts/size-debt.txt:3: packages/demo/src/runs/run.ts is listed twice. Remove one line.",
		]);
	});

	test("the folder list and the barrel list work the same way", () => {
		const files = {
			...Object.fromEntries(
				Array.from({ length: 27 }, (_, i) => [
					`${PKG}/src/steps/file-${i}.ts`,
					"export {};\n",
				]),
			),
			...under(`${PKG}/src/runs`, barrelOf(32)),
			[`${PKG}/src/steps/index.ts`]: "export {};\n",
		};
		expect(
			check(files, {
				folder: "packages/demo/src/steps 28\n",
				barrel: "packages/demo/src/runs/index.ts 32\n",
			}),
		).toEqual([]);
		expect(
			check(files, {
				folder: "packages/demo/src/steps 27\npackages/demo/src/runs 26\n",
				barrel:
					"packages/demo/src/runs/index.ts 31\npackages/demo/src/steps/index.ts 40\npackages/demo/src/gone/index.ts 40\n",
			}),
		).toEqual([
			"packages/demo/src/steps: 28 source files, and scripts/folder-debt.txt allows 27 (folder size, the limit is 25). A listed entry only shrinks. Move the files of one sub-domain into a sub-folder.",
			"scripts/folder-debt.txt: packages/demo/src/runs has 2 source files, within the limit of 25 (folder size). Remove its line.",
			"packages/demo/src/runs/index.ts: 32 names of its own, and scripts/barrel-debt.txt allows 31 (barrel width, the limit is 30). A listed entry only shrinks. Split the vertical into sub-verticals by sub-domain (a name counts on the barrel of its sub-vertical), or take names off the barrel.",
			"scripts/barrel-debt.txt: packages/demo/src/steps/index.ts has 0 names of its own, within the limit of 30 (barrel width). Remove its line.",
			"scripts/barrel-debt.txt: packages/demo/src/gone/index.ts is not a barrel in a vertical (barrel width). Remove its line.",
		]);
	});

	test("a run for one workspace does not judge the lines of another", () => {
		const root = tree({
			[`${PKG}/src/runs/run.ts`]: lines(700),
			[`${APP}/src/features/runs/page.tsx`]: lines(700),
			"scripts/check.ts": lines(700),
		});
		const lists = {
			...NO_DEBT,
			size: "packages/demo/src/runs/run.ts 700\napps/demo/src/features/gone.tsx 700\npackages/ghost/src/run.ts 700\n",
			peerPorts: "apps/demo features/flows features/runs\n",
		};
		// The app has an unlisted long file and two stale lines: not this run's.
		// A line of no workspace at all is a problem in every run.
		expect(checkBudgets(root, [PKG], lists, { peerPorts: {} })).toEqual([
			"scripts/size-debt.txt: packages/ghost/src/run.ts is not a source file (file size). Remove its line.",
		]);
		expect(checkBudgets(root, ["scripts"], NO_DEBT, { peerPorts: {} })).toEqual(
			[
				"scripts/check.ts: 700 lines, and the limit is 600 (file size). Split the file by sub-domain.",
			],
		);
		expect(checkBudgets(root, [APP], lists, { peerPorts: {} })).toHaveLength(4);
	});

	test("a name that is not a workspace fails", () => {
		const root = tree({});
		expect(
			checkBudgets(root, ["packages/nope"], NO_DEBT, { peerPorts: {} }),
		).toEqual(["packages/nope: is not a workspace."]);
	});

	test("the workspaces that the vertical check skips are not checked", () => {
		expect(
			check({
				"packages/ui/package.json": "{}\n",
				"packages/ui/src/components/table.tsx": lines(700),
			}),
		).toEqual([]);
	});
});

describe("--tighten", () => {
	test("it lowers a number, drops a clean or gone line, and adds and raises nothing", () => {
		const debt = [
			"# Long files.",
			"a.ts 900",
			"b.ts 900",
			"c.ts 900",
			"d.ts 700",
			"gone.ts 900",
			"",
		].join("\n");
		const sizes = new Map([
			["a.ts", 900],
			["b.ts", 650],
			["c.ts", 600],
			["d.ts", 800],
			["fresh.ts", 700],
		]);
		expect(tightened(FILE_SIZE, sizes, debt)).toBe(
			["# Long files.", "a.ts 900", "b.ts 650", "d.ts 700", ""].join("\n"),
		);
	});
});

describe("the command", () => {
	const root = join(import.meta.dir, "..");
	const read = (list: string) => Bun.file(join(root, list)).text();

	test("it passes on this repository, and fails without the debt lists", async () => {
		const lists: Lists = {
			size: await read(FILE_SIZE.list),
			folder: await read(FOLDER_SIZE.list),
			barrel: await read(BARREL_WIDTH.list),
			peerPorts: await read(PEER_PORT_LIST),
		};
		expect(checkBudgets(root, scopesOf(root), lists)).toEqual([]);
		for (const list of ["size", "folder", "barrel", "peerPorts"] as const) {
			expect(
				checkBudgets(root, scopesOf(root), { ...lists, [list]: "" }),
			).not.toEqual([]);
		}
	});

	test("every generated file has a reason", () => {
		for (const { file, why } of GENERATED) {
			expect(file).toMatch(/^(apps|packages)\/[^/]+\/src\/.+\.ts$/);
			expect(why.length).toBeGreaterThan(20);
		}
	});
});
