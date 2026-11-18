/**
 * The shape of a slice, the file rules (H6, H7) and the debt list (H10) of
 * scripts/check-rings.ts, on small repositories written to a temporary
 * folder: one slice in shape that passes, and one tree per rule that
 * breaks it. scripts/rings/imports.test.ts has the import rules.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { biomeProblems, checkRings, mechanismsOf } from "./check-rings";
import { camel, kebab } from "./rings/files";
import {
	check as checkFiles,
	type Files,
	gates,
	repository,
	SLICE,
} from "./rings/fixture";

const roots: string[] = [];

afterAll(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const check = (files: Files, options: Parameters<typeof checkFiles>[2] = {}) =>
	checkFiles(files, roots, options);

/** The barrels of a repository whose `schedules` has no wire function. */
const noWire: Files = {
	[`${SLICE}/index.ts`]: 'export type { Schedule } from "./domain/schedule";\n',
	"packages/engine/src/index.ts":
		'export type { Schedule } from "./schedules";\n',
};

describe("a slice in shape", () => {
	test("passes, with its wire.ts and its tests, the mechanisms and a listed vertical", async () => {
		expect(await check(repository)).toEqual([]);
	});

	test("a slice of domain/ alone passes, without a wire.ts", async () => {
		expect(await check({ ...repository, ...gates })).toEqual([]);
	});

	test("a sub-vertical in shape passes, and one out of shape fails", async () => {
		const sub = {
			...repository,
			[`${SLICE}/windows/index.ts`]:
				'export { inWindow } from "./domain/window";\n',
			[`${SLICE}/windows/domain/window.ts`]:
				"export const inWindow = (hour: number) => hour > 22;\n",
		};
		expect(await check(sub)).toEqual([]);
		const problems = await check({
			...sub,
			[`${SLICE}/windows/window.ts`]: "export const late = 23;\n",
		});
		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain(`${SLICE}/windows/: 1 file in the slice`);
		expect(problems[0]).toContain("(window.ts)");
	});
});

describe("the shape of a slice", () => {
	test("a file beside index.ts, wire.ts and the tests fails", async () => {
		const problems = await check({
			...repository,
			[`${SLICE}/cron.ts`]: "export const EVERY_NIGHT = 1;\n",
			[`${SLICE}/scheduler.ts`]: "export const TICK = 1;\n",
			[`${SLICE}/scheduler.test.ts`]: 'import "./index";\n',
			[`${SLICE}/test-support.ts`]: "export const support = 1;\n",
		});
		expect(problems).toEqual([
			`${SLICE}/: 2 files in the slice besides index.ts, wire.ts and tests (cron.ts, scheduler.ts). A slice holds only those, its rings (domain/, application/, adapters/) and its sub-verticals. Move each file into a ring.`,
		]);
	});

	test("a folder that is no ring and no sub-vertical fails", async () => {
		const problems = await check({
			...repository,
			[`${SLICE}/lib/cron.ts`]: "export const EVERY_NIGHT = 1;\n",
		});
		expect(problems).toEqual([
			`${SLICE}/lib/: a folder of a slice is a ring (domain/, application/, adapters/) or a sub-vertical with its own index.ts.`,
		]);
	});

	test("a vertical with only a barrel fails", async () => {
		const problems = await check({
			...repository,
			"packages/engine/src/usage/index.ts": "export const used = 1;\n",
		});
		expect(problems).toEqual([
			"packages/engine/src/usage/: has no domain/ and no application/. A slice has at least one of them, or sub-verticals that do.",
		]);
	});

	test("adapters/ holds only in/ and out/", async () => {
		const problems = await check({
			...repository,
			[`${SLICE}/adapters/git.ts`]: "export const git = 1;\n",
			[`${SLICE}/adapters/in/cron-timer.ts`]: "export const timer = 1;\n",
		});
		expect(problems).toEqual([
			`${SLICE}/adapters/: holds only out/ (the driven adapters) and in/ (the driving ones), but it has git.ts.`,
		]);
	});

	test("application/ is flat, and a ring holds no folder named like a ring", async () => {
		const problems = await check({
			...repository,
			[`${SLICE}/application/queries/list.ts`]: "export const list = 1;\n",
			[`${SLICE}/domain/adapters/cron.ts`]: "export const cron = 1;\n",
		});
		expect(problems).toEqual([
			`${SLICE}/application/queries/: application/ is flat. It holds ports.ts, one file per use case and its test.`,
			`${SLICE}/domain/adapters/: a folder named like a ring inside a ring. Name it for what it holds.`,
		]);
	});
});

describe("the wire.ts of a slice", () => {
	test("a slice with use cases and no wire.ts fails", async () => {
		const problems = await check({
			...repository,
			...noWire,
			[`${SLICE}/wire.ts`]: null,
			[`${SLICE}/wire.test.ts`]: null,
		});
		expect(problems).toEqual([
			`${SLICE}/: has use cases and no wire.ts. Add wire.ts, which exports the function "wireSchedules": it builds the real adapters and returns the use cases bound to their ports.`,
		]);
	});

	test("it exports one function, named for the slice", async () => {
		for (const [lines, words] of [
			[
				["export const createSchedules = () => ({});"],
				'the value "createSchedules"',
			],
			[
				[
					"export const wireSchedules = () => ({});",
					"export const TICK_MS = 30_000;",
				],
				'the values "TICK_MS", "wireSchedules"',
			],
			[
				["export const wireSchedules = { list: () => [] };"],
				'the value "wireSchedules", which is not written as a function',
			],
			[["export type Schedules = { list(): void };"], "no value"],
		] as const) {
			const problems = await check({
				...repository,
				...noWire,
				[`${SLICE}/wire.ts`]: [...lines],
				[`${SLICE}/wire.test.ts`]: null,
			});
			expect(problems).toEqual([
				`${SLICE}/wire.ts: a wire.ts exports one function, named for the slice ("wireSchedules"), and types. It exports ${words}.`,
			]);
		}
	});

	test("a dash in the name of the slice", async () => {
		const status = (name: string): Files => ({
			...repository,
			"packages/engine/src/run-folders/index.ts":
				'export { wireRunFolders } from "./wire";\n',
			"packages/engine/src/run-folders/wire.ts": `export const ${name} = () => ({});\n`,
			"packages/engine/src/run-folders/domain/folder.ts":
				"export const folderOf = (run: string) => run.length;\n",
		});
		expect(await check(status("wireRunFolders"))).toEqual([]);
		expect(await check(status("wireRunfolders"))).toHaveLength(1);
	});
});

describe("one use case per file (H6)", () => {
	const useCase = (lines: string[], withTest = true): Files => ({
		...repository,
		[`${SLICE}/application/list-schedules.ts`]: lines,
		[`${SLICE}/application/list-schedules.test.ts`]: withTest
			? 'import "./list-schedules";\n'
			: null,
	});

	test("one function and types pass, as a declaration too", async () => {
		expect(
			await check(
				useCase([
					"export type Listed = string[];",
					"export interface ListSchedulesPorts { all(): Listed }",
					"export function listSchedules(ports: ListSchedulesPorts): Listed {",
					"\treturn ports.all();",
					"}",
				]),
			),
		).toEqual([]);
	});

	test("two functions fail", async () => {
		const problems = await check(
			useCase([
				"export const listSchedules = () => [];",
				"export const countSchedules = () => 0;",
			]),
		);
		expect(problems).toEqual([
			`${SLICE}/application/list-schedules.ts: a use case file exports one function, named for the file ("listSchedules"), and types. It exports the values "countSchedules", "listSchedules".`,
		]);
	});

	test("a function with another name, a constant and no value fail", async () => {
		for (const [line, words] of [
			["export const allSchedules = () => [];", 'the value "allSchedules"'],
			[
				"export const listSchedules = { run: () => [] };",
				'the value "listSchedules", which is not written as a function',
			],
			["export type Listed = string[];", "no value"],
		] as const) {
			const problems = await check(useCase([line]));
			expect(problems).toHaveLength(1);
			expect(problems[0]).toContain(`It exports ${words}.`);
		}
	});

	test("a use case without a test fails", async () => {
		const problems = await check(
			useCase(["export const listSchedules = () => [];"], false),
		);
		expect(problems).toEqual([
			`${SLICE}/application/list-schedules.ts: has no test. Add list-schedules.test.ts beside it.`,
		]);
	});

	test("a test without a use case fails", async () => {
		const problems = await check({
			...repository,
			[`${SLICE}/application/ports.test.ts`]: 'import "./ports";\n',
			[`${SLICE}/application/scenarios.test.ts`]:
				'import "./create-schedule";\n',
		});
		expect(problems).toHaveLength(2);
		expect(problems[0]).toContain("there is no use case in ports.ts");
		expect(problems[1]).toContain("there is no scenarios.ts");
	});

	test("a value in ports.ts fails", async () => {
		const problems = await check({
			...repository,
			[`${SLICE}/application/ports.ts`]: [
				'import type { Schedule } from "../domain/schedule";',
				"export type ScheduleStore = { save(schedule: Schedule): Promise<void> };",
				"export const NO_STORE = undefined;",
			],
		});
		expect(problems).toEqual([
			`${SLICE}/application/ports.ts: ports.ts holds types only, but it exports the value "NO_STORE". Move it to a use case file or to domain/.`,
		]);
	});

	test("a file name that is not lower case with dashes fails", async () => {
		const problems = await check({
			...repository,
			[`${SLICE}/application/listSchedules.ts`]:
				"export const listSchedules = () => [];\n",
			[`${SLICE}/application/listSchedules.test.ts`]:
				'import "./listSchedules";\n',
		});
		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain("<verb>-<object>.ts");
	});
});

describe("a port has an in-memory adapter and a contract suite (H7)", () => {
	const OUT = `${SLICE}/adapters/out`;
	const PORTS = `${SLICE}/application/ports.ts`;

	test("the names of a port", () => {
		expect(kebab("ScheduleStore")).toBe("schedule-store");
		expect(kebab("OpenGates")).toBe("open-gates");
		expect(kebab("HTTPClient")).toBe("http-client");
		expect(kebab("Clock")).toBe("clock");
		expect(camel("schedule-store")).toBe("scheduleStore");
	});

	test("a port without its files fails, one message per file", async () => {
		const problems = await check({
			...repository,
			[`${OUT}/in-memory-schedule-store.ts`]: null,
			[`${OUT}/drizzle-schedule-store.ts`]: null,
			[`${OUT}/schedule-store.contract.ts`]: null,
			[`${OUT}/schedule-store.contract.test.ts`]: null,
			[`${SLICE}/wire.ts`]: "export const wireSchedules = () => ({});\n",
			[`${SLICE}/application/create-schedule.test.ts`]:
				'import "./create-schedule";\n',
		});
		expect(problems).toEqual([
			`${PORTS}: the port ScheduleStore has no in-memory adapter. Add adapters/out/in-memory-schedule-store.ts. If another slice or package implements the port, write @filledBy <who> in its comment.`,
			`${PORTS}: the port ScheduleStore has no real adapter. Add adapters/out/<tech>-schedule-store.ts (drizzle-schedule-store.ts).`,
			`${PORTS}: the port ScheduleStore has no contract suite. Add adapters/out/schedule-store.contract.ts, which exports the function "scheduleStoreContract".`,
			`${PORTS}: the port ScheduleStore has no test that runs its contract suite. Add adapters/out/schedule-store.contract.test.ts, which runs "scheduleStoreContract" on the in-memory adapter and on the real one.`,
		]);
	});

	test("a second port needs its own files", async () => {
		const problems = await check({
			...repository,
			[PORTS]: [
				'import type { Schedule } from "../domain/schedule";',
				"export type ScheduleStore = { save(schedule: Schedule): Promise<void> };",
				"export interface FiredTimes { last(): number }",
			],
		});
		expect(problems).toHaveLength(4);
		expect(problems[0]).toContain(
			"the port FiredTimes has no in-memory adapter. Add adapters/out/in-memory-fired-times.ts.",
		);
		expect(problems[1]).toContain("the port FiredTimes has no real adapter.");
		expect(problems[2]).toContain("the port FiredTimes has no contract suite.");
	});

	test("an in-memory adapter and a suite that do not name the port fail", async () => {
		const problems = await check({
			...repository,
			[`${OUT}/in-memory-schedule-store.ts`]:
				"export function inMemoryScheduleStore() {\n\treturn { save: async () => {} };\n}\n",
			[`${OUT}/schedule-store.contract.ts`]:
				"export function contract(make: () => unknown): void {\n\tmake();\n}\n",
		});
		expect(problems).toEqual([
			`${OUT}/in-memory-schedule-store.ts: does not import the port ScheduleStore from application/ports.ts. An in-memory adapter is typed by its port.`,
			`${OUT}/schedule-store.contract.ts: a contract suite exports one function, "scheduleStoreContract" here. It exports "contract".`,
			`${OUT}/schedule-store.contract.ts: does not import the port ScheduleStore from application/ports.ts. A contract suite is written against the port.`,
		]);
	});

	test("a contract test that runs on one adapter, or on none, fails", async () => {
		const TEST = `${OUT}/schedule-store.contract.test.ts`;
		expect(
			await check({
				...repository,
				[TEST]: [
					'import { inMemoryScheduleStore } from "./in-memory-schedule-store";',
					'import { scheduleStoreContract } from "./schedule-store.contract";',
					"scheduleStoreContract(inMemoryScheduleStore);",
				],
			}),
		).toEqual([
			`${TEST}: runs the contract suite on both adapters, but it does not import the real adapter (./drizzle-schedule-store).`,
		]);
		expect(
			await check({
				...repository,
				[TEST]: [
					'import { scheduleStoreContract } from "./schedule-store.contract";',
					"scheduleStoreContract(() => ({ save: async () => {} }));",
				],
			}),
		).toEqual([
			`${TEST}: runs the contract suite on both adapters, but it does not import ./in-memory-schedule-store and the real adapter (./drizzle-schedule-store).`,
		]);
	});

	const filled = (tag: string, twin: string[] | null): Files => ({
		...repository,
		[PORTS]: [
			'import type { Schedule } from "../domain/schedule";',
			"export type ScheduleStore = { save(schedule: Schedule): Promise<void> };",
			"/**",
			" * The runs a schedule starts.",
			` * ${tag}`,
			" */",
			"export type ScheduledRuns = { start(schedule: Schedule): Promise<string> };",
			`/** ${tag} */`,
			"export interface ScheduledProjects { all(): Promise<string[]> }",
		],
		[`${OUT}/in-memory-neighbours.ts`]: twin,
	});
	const neighbours = [
		'import type { ScheduledProjects, ScheduledRuns } from "../../application/ports";',
		'export const inMemoryRuns = (): ScheduledRuns => ({ start: async () => "run" });',
		"export const inMemoryProjects = (): ScheduledProjects => ({ all: async () => [] });",
	];

	test("a port with @filledBy needs an in-memory adapter only, and one file may hold several", async () => {
		for (const tag of [
			"@filledBy engine/projects",
			"@filledBy auth: the members of a Space",
		])
			expect(await check(filled(tag, neighbours))).toEqual([]);
	});

	test("a port with @filledBy and no in-memory adapter fails", async () => {
		const problems = await check(
			filled("@filledBy engine/projects", [
				'import type { ScheduledRuns } from "../../application/ports";',
				'export const inMemoryRuns = (): ScheduledRuns => ({ start: async () => "run" });',
			]),
		);
		expect(problems).toEqual([
			`${PORTS}: the port ScheduledProjects (filled by engine/projects) has no in-memory adapter. Write one in a file adapters/out/in-memory-*.ts that imports ScheduledProjects from application/ports.ts. One file may hold the in-memory adapters of several such ports.`,
		]);
	});

	test("@filledBy names a package or a vertical that exists, and not its own slice", async () => {
		for (const [tag, words] of [
			["@filledBy", "has @filledBy without a name"],
			[
				"@filledBy engine/gone",
				'has @filledBy "engine/gone", which is no package',
			],
			["@filledBy Devices", 'has @filledBy "Devices", which is no package'],
			[
				"@filledBy engine/schedules",
				'has @filledBy "engine/schedules", its own slice',
			],
		] as const) {
			const problems = await check(filled(tag, neighbours));
			expect(problems).toHaveLength(2);
			expect(problems[0]).toContain(`the port ScheduledProjects ${words}`);
			expect(problems[1]).toContain("the port ScheduledRuns");
		}
	});

	test("a port with @filledBy and a real adapter in its slice fails", async () => {
		const problems = await check({
			...filled("@filledBy engine/projects", neighbours),
			[`${OUT}/drizzle-scheduled-runs.ts`]: "export const runs = 1;\n",
		});
		expect(problems).toEqual([
			`${PORTS}: the port ScheduledRuns has @filledBy, but its real adapter is here (adapters/out/drizzle-scheduled-runs.ts). Remove the tag, and give the port its contract suite.`,
		]);
	});
});

describe("the debt list (H10)", () => {
	const flat: Files = {
		...repository,
		"packages/engine/src/usage/index.ts": 'export { used } from "./count";\n',
		"packages/engine/src/usage/count.ts": "export const used = 1;\n",
	};

	test("a vertical that is not listed keeps every rule", async () => {
		const problems = await check(flat);
		expect(problems).toHaveLength(2);
		expect(problems[0]).toContain(
			"packages/engine/src/usage/: 1 file in the slice besides index.ts, wire.ts and tests (count.ts).",
		);
		expect(problems[1]).toContain("has no domain/ and no application/");
	});

	test("a listed vertical is skipped, its import rules too", async () => {
		expect(
			await check(
				{
					...flat,
					"packages/engine/src/usage/domain/price.ts": [
						'import type { Database } from "@nightshift/db";',
						"export type Price = { db: Database };",
					],
				},
				{ debt: "engine/projects\nengine/usage\n" },
			),
		).toEqual([]);
	});

	test("a listed vertical in shape fails until its line is gone", async () => {
		expect(
			await check(repository, { debt: "engine/projects\nengine/schedules\n" }),
		).toEqual([
			"scripts/hexagon-debt.txt: engine/schedules is in shape. Remove it.",
		]);
	});

	test("a listed vertical in shape without application/ may stay", async () => {
		expect(
			await check(
				{ ...repository, ...gates },
				{ debt: "engine/projects\nengine/gates\n" },
			),
		).toEqual([]);
	});

	test("a line that names no vertical, a mechanism or a line twice fails", async () => {
		expect(
			await check(repository, {
				debt: [
					"# a comment",
					"engine/projects",
					"engine/gone",
					"engine/contract",
					"engine/projects",
					"web/flows",
				].join("\n"),
			}),
		).toEqual([
			"scripts/hexagon-debt.txt: engine/gone is not a vertical of a server package. Remove it.",
			"scripts/hexagon-debt.txt: engine/contract is a mechanism (scripts/capabilities.ts). The ring rules do not cover it. Remove it.",
			"scripts/hexagon-debt.txt: engine/projects is listed twice.",
			"scripts/hexagon-debt.txt: web/flows is not a vertical of a server package. Remove it.",
		]);
	});

	test("a mechanism is not checked", async () => {
		expect(
			await check(flat, {
				mechanisms: ["engine/contract", "engine/log", "engine/usage"],
			}),
		).toEqual([]);
	});

	test("a package that is no server package is not checked", async () => {
		expect(
			await check({
				...repository,
				"packages/api/package.json": JSON.stringify({
					name: "@nightshift/api",
					exports: { ".": "./src/index.ts" },
				}),
				"packages/api/src/index.ts": "export const router = 1;\n",
				"packages/api/src/schedules/index.ts":
					'export { list } from "./procedures";\n',
				"packages/api/src/schedules/procedures.ts": "export const list = 1;\n",
			}),
		).toEqual([]);
	});
});

describe("the mechanisms", () => {
	test("they come from the capability map, for the server packages only", () => {
		expect(
			mechanismsOf({
				"packages/engine": { contract: "mechanism", schedules: "schedules" },
				"packages/auth": { access: "access", "local-session": "mechanism" },
				"packages/api": { router: "mechanism" },
				"apps/web": { "shared/api": "mechanism" },
			}).sort(),
		).toEqual(["auth/local-session", "engine/contract"]);
	});
});

describe("the H4 override of biome.json", () => {
	const biome = readFileSync(join(import.meta.dir, "..", "biome.json"), "utf8");
	const edited = (edit: (overrides: { includes?: string[] }[]) => void) => {
		const config = JSON.parse(biome);
		edit(config.overrides);
		return JSON.stringify(config);
	};
	const isH4 = (override: object) =>
		JSON.stringify(override).includes("noRestrictedGlobals");

	test("this repository's override names the rings and the kernel of each package", () => {
		expect(biomeProblems(biome)).toEqual([]);
	});

	test("a missing kernel folder, and a folder that is no kernel, fail", () => {
		const problems = biomeProblems(
			edited((overrides) => {
				const h4 = overrides.find(isH4);
				h4?.includes?.pop();
				h4?.includes?.push("packages/engine/src/log/**");
			}),
		);
		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain(
			'It lacks "packages/notifications/src/contract/**". Remove "packages/engine/src/log/**".',
		);
	});

	test("no override, and one that does not deny a global, fail", () => {
		expect(
			biomeProblems(
				edited((overrides) => overrides.splice(overrides.findIndex(isH4), 1)),
			),
		).toEqual([
			"biome.json: H4 is one override with style/noRestrictedGlobals. It has 0.",
		]);
		expect(biomeProblems(biome.replace('"fetch": ', '"fetched": '))).toEqual([
			'biome.json: the override with noRestrictedGlobals has the level "error" and denies Bun, fetch, process (H4).',
		]);
	});
});

describe("the command", () => {
	test("it passes on this repository, and only with its debt list", async () => {
		const root = join(import.meta.dir, "..");
		const debt = readFileSync(
			join(import.meta.dir, "hexagon-debt.txt"),
			"utf8",
		);
		const mechanisms = mechanismsOf();
		expect(await checkRings(root, { mechanisms, debt })).toEqual([]);
		expect(await checkRings(root, { mechanisms, debt: "" })).not.toEqual([]);
		// It reads every file of the six packages twice.
	}, 60_000);
});
