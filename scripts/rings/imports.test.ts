/**
 * The import rules of scripts/check-rings.ts (H1, H2, H3, H5, H8, the rule
 * for adapters/in/ and the kernel of a package), on small repositories
 * written to a temporary folder. They run through dependency-cruiser, as
 * in the command. H4 runs through Biome, with this repository's
 * biome.json.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { copyFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { TESTS } from "../../.dependency-cruiser.mjs";
import { measure } from "../check-budgets";
import { isTest } from "../check-layers";
import { checkWorkspace } from "../check-verticals";
import {
	check as checkFiles,
	type Files,
	gates,
	repository,
	SLICE,
	write,
} from "./fixture";

const roots: string[] = [];

afterAll(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const check = (files: Files, options: Parameters<typeof checkFiles>[2] = {}) =>
	checkFiles(files, roots, options);

const H1 =
	"domain/ imports only its own domain/, the kernel of its package (the barrel of contract/, and of run-status/ in the engine), the shared kernel (@nightshift/refusal, @nightshift/time, @nightshift/semconv, the @nightshift/flows root), zod and node:crypto (H1).";
const H5 =
	"Only the wire.ts of its slice, a file of its adapters/out/ and a test import a real adapter (H5).";

describe("domain/ imports (H1)", () => {
	const domain = (lines: string[]): Files => ({
		...repository,
		[`${SLICE}/domain/window.ts`]: lines,
	});

	test("application/ of its own slice fails", async () => {
		const problems = await check(
			domain([
				'import type { ScheduleStore } from "../application/ports";',
				"export type Window = { store: ScheduleStore };",
			]),
		);
		expect(problems).toEqual([
			`${SLICE}/domain/window.ts: imports "../application/ports" (${SLICE}/application/ports.ts). ${H1}`,
		]);
	});

	test("the barrel of another slice, and of a mechanism that is not kernel, fail", async () => {
		const problems = await check(
			domain([
				'import type { LoggedEvent } from "../../log";',
				'import { projectOf } from "../../projects";',
				"export const window = projectOf;",
				"export type Logged = LoggedEvent;",
			]),
		);
		expect(problems).toHaveLength(2);
		expect(problems[0]).toContain('imports "../../log"');
		expect(problems[1]).toContain('imports "../../projects"');
		for (const problem of problems) expect(problem).toContain("(H1)");
	});

	test("a file of the kernel past its barrel fails", async () => {
		const problems = await check(
			domain([
				'import type { Actor } from "../../contract/actor";',
				"export type Window = { owner: Actor };",
			]),
		);
		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain('imports "../../contract/actor"');
	});

	test("an entry of flows other than the root fails", async () => {
		const problems = await check(
			domain([
				'import { dataProblem } from "@nightshift/flows/json-schema";',
				"export const window = dataProblem;",
			]),
		);
		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain('imports "@nightshift/flows/json-schema"');
	});

	test("an npm package other than zod, and a Node module, fail", async () => {
		const problems = await check(
			domain([
				'import { join } from "node:path";',
				'import { ulid } from "ulid";',
				"export const window = [join, ulid];",
			]),
		);
		expect(problems).toHaveLength(2);
		expect(problems[0]).toContain('imports "path"');
		expect(problems[1]).toContain('imports "ulid"');
	});

	test("node:crypto passes, in application/ too", async () => {
		expect(
			await check({
				...domain([
					'import { createHmac } from "node:crypto";',
					"export const window = createHmac;",
				]),
				[`${SLICE}/application/ports.ts`]: [
					'import type { Hmac } from "node:crypto";',
					'import type { Schedule } from "../domain/schedule";',
					"export type ScheduleStore = {",
					"\tsave(schedule: Schedule, proof?: Hmac): Promise<void>;",
					"};",
				],
			}),
		).toEqual([]);
	});

	test("a test in domain/ keeps the rule, and production code imports no ./testing", async () => {
		const problems = await check({
			...repository,
			[`${SLICE}/domain/schedule.test.ts`]: [
				'import { expect, test } from "bun:test";',
				'import { projectOf } from "../../projects";',
				'test("x", () => expect(projectOf).toBeDefined());',
			],
			[`${SLICE}/domain/window.ts`]: [
				'import { utc } from "@nightshift/time/testing";',
				"export const window = utc;",
			],
		});
		expect(problems).toHaveLength(2);
		expect(problems[0]).toContain(`${SLICE}/domain/schedule.test.ts`);
		expect(problems[0]).toContain("A test in domain/");
		expect(problems[1]).toContain('imports "@nightshift/time/testing"');
	});
});

describe("application/ imports (H2)", () => {
	const useCase = (lines: string[]): Files => ({
		...repository,
		[`${SLICE}/application/list-schedules.ts`]: [
			...lines,
			"export const listSchedules = () => [];",
		],
		[`${SLICE}/application/list-schedules.test.ts`]:
			'import "./list-schedules";\n',
	});

	test("an adapter fails, the in-memory one too", async () => {
		const problems = await check(
			useCase([
				'import { inMemoryScheduleStore } from "../adapters/out/in-memory-schedule-store";',
				"export type Made = typeof inMemoryScheduleStore;",
			]),
		);
		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain(
			'imports "../adapters/out/in-memory-schedule-store"',
		);
		expect(problems[0]).toContain("Never adapters/ (H2)");
	});

	test("a file of another slice past its barrel fails", async () => {
		const problems = await check(
			useCase([
				'import { projectOf } from "../../projects/project";',
				"export type Project = typeof projectOf;",
			]),
		);
		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain('imports "../../projects/project"');
	});

	test("another package fails: it comes through a port", async () => {
		const problems = await check(
			useCase([
				'import type { membersOf } from "@nightshift/auth";',
				"export type Members = typeof membersOf;",
			]),
		);
		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain(
			'imports "@nightshift/auth" (packages/auth/src/index.ts)',
		);
	});

	test("its own barrel and the root index of the package fail", async () => {
		const problems = await check(
			useCase([
				'import type { Schedule } from "..";',
				'import type { wireSchedules } from "../..";',
				"export type Both = [Schedule, typeof wireSchedules];",
			]),
		);
		expect(problems).toHaveLength(2);
	});

	test("a use case of another slice, through its barrel, passes", async () => {
		expect(
			await check({
				...useCase([
					'import { mayAnswer } from "../../gates";',
					"export type Answered = ReturnType<typeof mayAnswer>;",
				]),
				...gates,
			}),
		).toEqual([]);
	});

	test("a value of a mechanism that is not kernel fails, a type of it passes", async () => {
		const problems = await check(
			useCase([
				'import { appendEvent, type LoggedEvent } from "../../log";',
				"export type Appended = [typeof appendEvent, LoggedEvent];",
			]),
		);
		expect(problems).toEqual([
			`${SLICE}/application/list-schedules.ts: imports "../../log" (packages/engine/src/log/index.ts). application/ imports only types from a mechanism that is not kernel (import type). What a mechanism does comes in through a port (H2).`,
		]);
		for (const line of [
			'import type { LoggedEvent } from "../../log";',
			'import { type LoggedEvent } from "../../log";',
		])
			expect(
				await check(useCase([line, "export type Logged = LoggedEvent;"])),
			).toEqual([]);
	});

	test("a use-case test imports no value of a mechanism either", async () => {
		const problems = await check({
			...repository,
			[`${SLICE}/application/create-schedule.test.ts`]: [
				'import { test } from "bun:test";',
				'import { appendEvent } from "../../log";',
				'test("x", () => appendEvent);',
			],
		});
		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain("comes in through a port (H2)");
	});
});

describe("the outside world (H3)", () => {
	test("a type-only import of the database in application/ fails, once", async () => {
		const problems = await check({
			...repository,
			[`${SLICE}/application/ports.ts`]: [
				'import type { Database } from "@nightshift/db";',
				'import type { Schedule } from "../domain/schedule";',
				"export type ScheduleStore = {",
				"\tsave(schedule: Schedule, db: Database): Promise<void>;",
				"};",
			],
		});
		expect(problems).toEqual([
			`${SLICE}/application/ports.ts: imports "@nightshift/db" (packages/db/src/index.ts). Only adapters/out/ imports the database, a folder, a process, the network, Yjs or LangChain. A type-only import counts, and so does a test (H3, H8).`,
		]);
	});

	test("a type written as import() fails: the rules read import statements", async () => {
		const problems = await check({
			...repository,
			[`${SLICE}/domain/window.ts`]:
				'export type Window = { db: import("@nightshift/db").Database };\n',
		});
		expect(problems).toEqual([
			`${SLICE}/domain/window.ts: writes a type as import("@nightshift/db"). Write an "import type" statement: the ring rules read it.`,
		]);
	});

	test("node:fs, a child process, drizzle, Yjs and LangChain in domain/ fail", async () => {
		const problems = await check({
			...repository,
			[`${SLICE}/domain/window.ts`]: [
				'import { readFileSync } from "node:fs";',
				'import { readFile } from "node:fs/promises";',
				'import { spawn } from "node:child_process";',
				'import { Database } from "bun:sqlite";',
				'import { eq } from "drizzle-orm";',
				'import * as Y from "yjs";',
				'import type { Document } from "@langchain/core/documents";',
				"export const window = [readFileSync, readFile, spawn, Database, eq, Y];",
				"export type Page = Document;",
			],
		});
		expect(problems).toHaveLength(7);
		for (const problem of problems) expect(problem).toContain("(H3, H8)");
	});
});

describe("a real adapter (H5)", () => {
	const REAL = `${SLICE}/adapters/out/drizzle-schedule-store.ts`;
	const IMPORT =
		'import { drizzleScheduleStore } from "../schedules/adapters/out/drizzle-schedule-store";';

	test("a barrel that passes one on fails", async () => {
		const problems = await check({
			...repository,
			[`${SLICE}/index.ts`]: [
				'export { drizzleScheduleStore } from "./adapters/out/drizzle-schedule-store";',
				'export { wireSchedules } from "./wire";',
			],
		});
		expect(problems).toEqual([
			`${SLICE}/index.ts: imports "./adapters/out/drizzle-schedule-store" (${REAL}). ${H5} A barrel never passes one on: it exports the wire function of the slice.`,
		]);
	});

	test("a file of a listed vertical that imports one fails", async () => {
		const problems = await check({
			...repository,
			"packages/engine/src/projects/project.ts": [
				IMPORT,
				"export const projectOf = (id: string) => id + drizzleScheduleStore.name;",
			],
		});
		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain("packages/engine/src/projects/project.ts");
		expect(problems[0]).toContain(H5);
	});

	test("the wire.ts of the package, and of another slice, fail", async () => {
		const problems = await check({
			...repository,
			...gates,
			"packages/engine/src/wire.ts": [
				'import { drizzleScheduleStore } from "./schedules/adapters/out/drizzle-schedule-store";',
				"export const wired = drizzleScheduleStore;",
			],
			"packages/engine/src/gates/wire.ts": [
				IMPORT,
				"export const wireGates = () => drizzleScheduleStore;",
			],
		});
		expect(problems).toHaveLength(2);
		expect(problems[0]).toContain("packages/engine/src/gates/wire.ts");
		expect(problems[0]).toContain(
			"A wire.ts builds the adapters of its own slice, and calls the wire function of another slice.",
		);
		expect(problems[1]).toContain("packages/engine/src/wire.ts");
	});

	test("an adapter of another slice that imports one fails", async () => {
		const problems = await check({
			...repository,
			...gates,
			"packages/engine/src/gates/adapters/out/drizzle-gates.ts": [
				'import { drizzleScheduleStore } from "../../../schedules/adapters/out/drizzle-schedule-store";',
				"export const status = drizzleScheduleStore;",
			],
		});
		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain(
			"An adapter imports no real adapter of another slice.",
		);
	});

	test("a file of the same adapters/out/ and a test may import one", async () => {
		expect(
			await check({
				...repository,
				[`${SLICE}/adapters/out/drizzle-rows.ts`]: [
					'import { drizzleScheduleStore } from "./drizzle-schedule-store";',
					"export const rows = drizzleScheduleStore;",
				],
				"packages/engine/src/projects/project.test.ts": [
					IMPORT,
					"export const made = drizzleScheduleStore;",
				],
			}),
		).toEqual([]);
	});

	test("a real adapter of a listed vertical is not checked yet", async () => {
		expect(
			await check({
				...repository,
				"packages/engine/src/projects/adapters/out/git-clones.ts":
					"export const clones = 1;\n",
				"packages/engine/src/projects/project.ts": [
					'import { clones } from "./adapters/out/git-clones";',
					"export const projectOf = (id: string) => id + clones;",
				],
			}),
		).toEqual([]);
	});

	test("a type written as import() that names one fails", async () => {
		const problems = await check({
			...repository,
			"packages/engine/src/projects/project.ts": [
				'export type Store = import("../schedules/adapters/out/drizzle-schedule-store").Made;',
				"export const projectOf = (id: string) => id;",
			],
		});
		expect(problems).toEqual([
			'packages/engine/src/projects/project.ts: writes a type as import("../schedules/adapters/out/drizzle-schedule-store"). Write an "import type" statement: the ring rules read it.',
		]);
	});
});

describe("a driving adapter in adapters/in/", () => {
	const TICKER = `${SLICE}/adapters/in/schedule-ticker.ts`;

	test("one that imports nothing of its slice passes, with its test", async () => {
		expect(
			await check({
				...repository,
				[TICKER]: [
					'import { now } from "@nightshift/time";',
					'import { setTimeout } from "node:timers";',
					"export const createScheduleTicker = (fire: () => void) =>",
					"\tsetTimeout(fire, now());",
				],
				[`${SLICE}/adapters/in/schedule-ticker.test.ts`]: [
					'import { createSchedule } from "../../application/create-schedule";',
					'import { createScheduleTicker } from "./schedule-ticker";',
					"export const both = [createSchedule, createScheduleTicker];",
				],
			}),
		).toEqual([]);
	});

	test("one that imports a use case, the domain or an adapter fails", async () => {
		const problems = await check({
			...repository,
			[TICKER]: [
				'import type { createSchedule } from "../../application/create-schedule";',
				'import type { Schedule } from "../../domain/schedule";',
				'import { drizzleScheduleStore } from "../out/drizzle-schedule-store";',
				"export const createScheduleTicker = (",
				"\tfire: ReturnType<typeof createSchedule>,",
				"\tschedule: Schedule,",
				") => [fire, schedule, drizzleScheduleStore];",
			],
		});
		const own = problems.filter((problem) =>
			problem.includes(
				"A driving adapter in adapters/in/ imports nothing of its slice. The wire.ts hands it the bound use case.",
			),
		);
		expect(own).toHaveLength(3);
		// The real adapter also breaks H5.
		expect(problems).toHaveLength(4);
		for (const problem of problems) expect(problem).toContain(TICKER);
	});
});

describe("a use-case test (H8)", () => {
	const TEST = `${SLICE}/application/create-schedule.test.ts`;
	const withTest = (lines: string[]): Files => ({
		...repository,
		[TEST]: ['import { test } from "bun:test";', ...lines],
	});

	test("a database, a folder and a process fail", async () => {
		const problems = await check(
			withTest([
				'import type { Database } from "@nightshift/db";',
				'import { mkdtempSync } from "node:fs";',
				'import { spawnSync } from "node:child_process";',
				'test("x", () => [mkdtempSync, spawnSync, {} as Database]);',
			]),
		);
		expect(problems).toHaveLength(3);
		for (const problem of problems) {
			expect(problem).toContain(TEST);
			expect(problem).toContain("(H3, H8)");
		}
	});

	test("a real adapter and a testing/ folder fail", async () => {
		const problems = await check({
			...withTest([
				'import { sandbox } from "../../testing/sandbox";',
				'import { drizzleScheduleStore } from "../adapters/out/drizzle-schedule-store";',
				'test("x", () => [sandbox, drizzleScheduleStore]);',
			]),
			"packages/engine/src/testing/sandbox.ts": "export const sandbox = 1;\n",
		});
		expect(problems).toHaveLength(2);
		for (const problem of problems) {
			expect(problem).toContain(
				"It starts no database, folder or process (H2, H8).",
			);
		}
	});
});

describe("the kernel of a package is pure", () => {
	const impure: Files = {
		...repository,
		"packages/engine/src/contract/command.ts": [
			'import type { Database } from "@nightshift/db";',
			"export type Command = { db: Database };",
		],
		"packages/engine/src/contract/command.test.ts": [
			'import { readFileSync } from "node:fs";',
			"export const read = readFileSync;",
		],
	};
	const LINE = "kernel packages/engine/src/contract/command.ts";

	test("a kernel file that imports the database fails, a test of it does not", async () => {
		expect(await check(impure)).toEqual([
			'packages/engine/src/contract/command.ts: imports "@nightshift/db" (packages/db/src/index.ts). A kernel mechanism imports no database, folder, process or network module, type-only imports included: every domain/ of its package may import it (H3).',
		]);
	});

	test("a listed kernel file is skipped, and fails once it is pure or gone", async () => {
		const debt = `engine/projects\n${LINE}\n`;
		expect(await check(impure, { debt })).toEqual([]);
		expect(await check(repository, { debt })).toEqual([
			`scripts/hexagon-debt.txt: ${LINE} is not a file. Remove it.`,
		]);
		expect(
			await check(
				{
					...repository,
					"packages/engine/src/contract/command.ts":
						"export type Command = { kind: string };\n",
				},
				{ debt: `${debt}${LINE}\n` },
			),
		).toEqual([
			`scripts/hexagon-debt.txt: ${LINE} is pure now. Remove it.`,
			`scripts/hexagon-debt.txt: ${LINE} is listed twice.`,
		]);
	});

	test("a type written as import() in the kernel fails", async () => {
		const problems = await check({
			...repository,
			"packages/engine/src/contract/command.ts":
				'export type Command = { db: import("@nightshift/db").Database };\n',
		});
		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain('writes a type as import("@nightshift/db")');
	});

	test("a mechanism that is not kernel may import the database", async () => {
		// `engine/log` of the repository does.
		expect(await check(repository)).toEqual([]);
	});
});

describe("the globals (H4, biome.json)", () => {
	/** Biome's findings for this rule in `files`, with this repository's biome.json. */
	function lint(files: Files): string {
		// biome.json names the web app's stylesheet.
		const root = write({ ...files, "apps/web/src/index.css": "" }, roots);
		const repo = join(import.meta.dir, "..", "..");
		copyFileSync(join(repo, "biome.json"), join(root, "biome.json"));
		const run = Bun.spawnSync(
			[
				join(repo, "node_modules/.bin/biome"),
				"lint",
				"--only=style/noRestrictedGlobals",
				"--colors=off",
				"--max-diagnostics=none",
				"packages",
			],
			{ cwd: root, stdout: "pipe", stderr: "pipe" },
		);
		return `${run.stdout.toString()}${run.stderr.toString()}`;
	}

	const uses =
		"export const read = () => [Bun.env.HOME, process.env.HOME, fetch];\n";
	const src = "packages/engine/src";

	test("Bun, fetch and process fail in domain/ and application/, tests included, and in the kernel", () => {
		const files = [
			"schedules/domain/window.ts",
			"schedules/application/list-schedules.ts",
			"schedules/application/list-schedules.test.ts",
			"schedules/windows/domain/window.ts",
			"contract/command.ts",
			"run-status/actions.ts",
		];
		const output = lint(
			Object.fromEntries(files.map((file) => [`${src}/${file}`, uses])),
		);
		for (const file of files) expect(output).toContain(`${src}/${file}`);
		expect(output).toContain("Only adapters/out/ uses Bun.");
		expect(output).toContain("Only adapters/out/ uses fetch.");
		expect(output).toContain("Only adapters/out/ uses process.");
		expect(output).toContain("Found 18 errors.");
	});

	test("they pass in adapters/, in wire.ts and outside the rings", () => {
		const output = lint({
			[`${src}/schedules/adapters/out/http-clock.ts`]: uses,
			[`${src}/schedules/adapters/in/timer.ts`]: uses,
			[`${src}/schedules/wire.ts`]: uses,
			[`${src}/projects/project.ts`]: uses,
			[`${src}/log/run-log.ts`]: uses,
		});
		expect(output).not.toContain("noRestrictedGlobals");
		expect(output).toContain("Checked 5 files");
	});
});

describe("twins and contract suites are test code", () => {
	const twin = "src/schedules/adapters/out/in-memory-schedule-store.ts";
	const suite = "src/schedules/adapters/out/schedule-store.contract.ts";

	test("isTest names exactly those two patterns of adapters/out/", () => {
		for (const path of [
			twin,
			suite,
			"src/flows/editing/adapters/out/in-memory-neighbours.ts",
			"src/schedules/adapters/out/schedule-store.contract.test.ts",
		])
			expect(isTest(path)).toBe(true);
		for (const path of [
			"src/schedules/adapters/out/drizzle-schedule-store.ts",
			"src/schedules/adapters/out/memory/in-memory-rows.ts",
			"src/schedules/adapters/in/in-memory-timer.ts",
			"src/schedules/domain/in-memory-schedule.ts",
			"src/schedules/domain/schedule.contract.ts",
			"src/schedules/in-memory-schedule-store.ts",
		])
			expect(isTest(path)).toBe(false);
	});

	test("the ring rules call the same files a test", () => {
		const patterns = TESTS.map((pattern) => new RegExp(pattern));
		for (const path of [
			twin,
			suite,
			"src/schedules/adapters/out/drizzle-schedule-store.ts",
			"src/schedules/adapters/out/memory/in-memory-rows.ts",
			"src/schedules/domain/schedule.contract.ts",
			"src/schedules/domain/schedule.test.ts",
			"src/schedules/test-support.ts",
			"src/testing/sandbox.ts",
			"src/schedules/domain/fixtures/night.ts",
			"src/schedules/wire.ts",
		])
			expect(patterns.some((pattern) => pattern.test(path))).toBe(isTest(path));
	});

	test("production code that imports one fails the vertical check", () => {
		const root = write(
			{
				...repository,
				[`${SLICE}/wire.ts`]: [
					'import { inMemoryScheduleStore } from "./adapters/out/in-memory-schedule-store";',
					'import { createSchedule } from "./application/create-schedule";',
					"export const wireSchedules = () =>",
					"\tcreateSchedule({ schedules: inMemoryScheduleStore() });",
				],
			},
			roots,
		);
		const problems = checkWorkspace(root, "packages/engine").filter((problem) =>
			problem.includes("which only tests may use"),
		);
		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain(`${SLICE}/wire.ts`);
		expect(problems[0]).toContain("in-memory-schedule-store");
	});

	test("the budgets do not count them as source", () => {
		const root = write(repository, roots);
		const sizes = measure(root, ["packages/engine"]);
		expect(sizes.folders.get(`${SLICE}/adapters/out`)).toBe(1);
		expect([...sizes.files.keys()].filter((f) => f.includes("/out/"))).toEqual([
			`${SLICE}/adapters/out/drizzle-schedule-store.ts`,
		]);
	});
});

describe("path aliases", () => {
	test("a server package with tsconfig paths fails: the rules do not read them", async () => {
		const problems = await check({
			...repository,
			"packages/engine/tsconfig.json": JSON.stringify({
				compilerOptions: { paths: { "@/*": ["./src/*"] } },
			}),
		});
		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain("packages/engine/tsconfig.json");
	});
});
