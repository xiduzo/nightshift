/** The rules of a port of the database (`scripts/rings/database-ports.ts`, H7 and H8), red and green. */
import { afterAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";

import { check as checkFiles, type Files, repository, SLICE } from "./fixture";

const roots: string[] = [];
afterAll(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true });
});
const check = (files: Files) => checkFiles(files, roots);

describe("a port of the database (H7, ADR 44)", () => {
	const OUT = `${SLICE}/adapters/out`;
	const PORTS = `${SLICE}/application/ports.ts`;
	const ADAPTER = `${OUT}/drizzle-fired-times.ts`;
	const TEST = `${OUT}/drizzle-fired-times.test.ts`;
	const SUITE = `${OUT}/fired-times.contract.ts`;
	const twin = (file: string) =>
		`${file}: FiredTimes is a port of the database, so it has no in-memory adapter. Its use-case tests run on drizzle-fired-times.ts, over migratedDb() of @nightshift/db/testing (ADR 44). To change one member for a test, spread the real adapter and write that member.`;
	const suite = (file: string) =>
		`${file}: FiredTimes has one adapter, so it has no contract suite. Move the tests to drizzle-fired-times.test.ts.`;
	const files: Files = {
		...repository,
		[PORTS]: [
			'import type { Schedule } from "../domain/schedule";',
			"export type ScheduleStore = { save(schedule: Schedule): Promise<void> };",
			"export type FiredTimes = { last(id: string): number };",
		],
		[ADAPTER]: [
			'import type { FiredTimes } from "../../application/ports";',
			"export const drizzleFiredTimes = (): FiredTimes => ({ last: () => 1 });",
		],
		[TEST]: [
			'import { drizzleFiredTimes } from "./drizzle-fired-times";',
			'test("x", () => expect(drizzleFiredTimes().last("a")).toBe(1));',
		],
		[`${SLICE}/application/list-schedules.ts`]: [
			'import type { FiredTimes } from "./ports";',
			"export const listSchedules = (ports: { times: FiredTimes }) => (id: string) => ports.times.last(id) + 1;",
		],
		[`${SLICE}/application/list-schedules.test.ts`]: [
			'import { schedulePorts } from "../test-support";',
			'import { listSchedules } from "./list-schedules";',
			'expect(listSchedules(schedulePorts())("a")).toBe(2);',
		],
		[`${SLICE}/test-support.ts`]: [
			'import { drizzleFiredTimes } from "./adapters/out/drizzle-fired-times";',
			"export const schedulePorts = () => ({ times: drizzleFiredTimes() });",
		],
	};

	test("one that a use case reads passes with its adapter's test: it needs no twin and no suite", async () => {
		expect(await check(files)).toEqual([]);
	});

	test("an in-memory adapter of it, and a contract suite, fail", async () => {
		expect(
			await check({
				...files,
				[`${OUT}/in-memory-fired-times.ts`]: [
					'import type { FiredTimes } from "../../application/ports";',
					"export const inMemoryFiredTimes = (): FiredTimes => ({ last: () => 1 });",
				],
				[SUITE]: [
					"export function firedTimesContract(make: () => unknown): void {",
					"\texpect(make()).toBeDefined();",
					"}",
				],
			}),
		).toEqual([suite(SUITE), twin(`${OUT}/in-memory-fired-times.ts`)]);
	});

	test("its adapter without a test, and a test that imports another thing or expects nothing, fail", async () => {
		expect(await check({ ...files, [TEST]: null })).toEqual([
			`${ADAPTER}: the adapter of FiredTimes has no test. Add drizzle-fired-times.test.ts beside it, over migratedDb() of @nightshift/db/testing.`,
		]);
		expect(await check({ ...files, [TEST]: "expect(1).toBe(1);\n" })).toEqual([
			`${TEST}: does not import the adapter it tests (./drizzle-fired-times).`,
		]);
		expect(
			await check({
				...files,
				[TEST]: [
					'import { drizzleFiredTimes } from "./drizzle-fired-times";',
					"drizzleFiredTimes();",
				],
			}),
		).toEqual([`${TEST}: expects no outcome of the adapter.`]);
	});

	test("a use-case test takes no test-support.ts of another slice", async () => {
		const problems = await check({
			...files,
			"packages/engine/src/gates/index.ts":
				'export { mayAnswer } from "./domain/answer";\n',
			"packages/engine/src/gates/domain/answer.ts":
				"export const mayAnswer = (status: string) => status.length > 0;\n",
			"packages/engine/src/gates/test-support.ts": "export const gates = 1;\n",
			[`${SLICE}/application/list-schedules.test.ts`]: [
				'import { gates } from "../../gates/test-support";',
				'import { listSchedules } from "./list-schedules";',
				"expect([gates, listSchedules]).toBeDefined();",
			],
		});
		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain('imports "../../gates/test-support"');
	});

	const IMPORT = 'import type { FiredTimes } from "../../application/ports";';
	const REAL = 'import { drizzleFiredTimes } from "./drizzle-fired-times";';
	const made = "({ last: () => 1 })";

	for (const [how, lines] of [
		[
			"a return type",
			[IMPORT, `export const log = (): FiredTimes => ${made};`],
		],
		[
			"a declaration",
			[
				IMPORT,
				`export function log(): FiredTimes { const rows = ${made}; return rows; }`,
			],
		],
		["a variable", [IMPORT, `export const log: FiredTimes = ${made};`]],
		[
			"satisfies",
			[
				IMPORT,
				`const log = ${made};`,
				"export const twin = log satisfies FiredTimes;",
			],
		],
		[
			"as",
			[
				IMPORT,
				`export const log = ${made} as unknown as Pick<FiredTimes, "last">;`,
			],
		],
		[
			"a class",
			[
				IMPORT,
				"export class Log implements FiredTimes { last() { return 1; } }",
			],
		],
		[
			"another name of the type",
			[
				IMPORT.replace("FiredTimes", "FiredTimes as Port"),
				"type Log = Partial<Port>;",
				`export const log: Log = ${made};`,
			],
		],
		[
			"a function elsewhere in the file",
			[
				IMPORT,
				`const make = () => ${made};`,
				"export const log: FiredTimes = make();",
			],
		],
		[
			"the type of the real one",
			[
				REAL,
				`export const log: ReturnType<typeof drizzleFiredTimes> = ${made};`,
			],
		],
		[
			"a spread of its own rows",
			[
				IMPORT,
				`const rows = ${made};`,
				"export const log: FiredTimes = { ...rows };",
			],
		],
		[
			"the real one beside it",
			[
				IMPORT,
				REAL,
				"export const real = drizzleFiredTimes();",
				`export const log: FiredTimes = ${made};`,
			],
		],
		[
			"one member of its own, the other of the real one",
			[
				IMPORT,
				REAL,
				"const real = drizzleFiredTimes();",
				"export const log: FiredTimes = { last: real.last, first: () => 1 };",
			],
		],
	] as const)
		for (const file of [
			"in-memory-log.ts",
			"memory-fired-times.ts",
			"log.test.ts",
		])
			test(`a twin fails in ${file}: ${how}`, async () => {
				const path = `${OUT}/${file}`;
				expect(await check({ ...files, [path]: [...lines] })).toContain(
					twin(path),
				);
			});

	test("an in-memory adapter with the port's name fails without a type too", async () => {
		const path = `${OUT}/in-memory-fired-times.ts`;
		expect(
			await check({
				...files,
				[path]: `export const inMemoryFiredTimes = () => ${made};\n`,
			}),
		).toEqual([twin(path)]);
	});

	test("a port of the same name in another slice is another port", async () => {
		expect(
			await check({
				...files,
				"packages/engine/src/projects/ports.ts":
					"export type FiredTimes = { last(id: string): number };\n",
				[`${OUT}/log.test.ts`]: [
					'import type { FiredTimes } from "../../../projects/ports";',
					`export const log: FiredTimes = ${made};`,
				],
			}),
		).toEqual([]);
	});

	test("a twin fails in test-support.ts, in a test/ folder, and through a barrel of the package", async () => {
		const support = `${SLICE}/test-support.ts`;
		const line = `export const schedulePorts = (): { times: unknown } => { const times: FiredTimes = ${made}; return { times }; };`;
		expect(
			await check({
				...files,
				[support]: [
					'import type { FiredTimes } from "./application/ports";',
					line,
				],
			}),
		).toEqual([twin(support)]);
		const engineTest = "packages/engine/test/fakes.ts";
		expect(
			await check({
				...files,
				[`${SLICE}/index.ts`]: [
					'export type { FiredTimes } from "./application/ports";',
					'export { wireSchedules } from "./wire";',
				],
				[engineTest]: [
					'import type { FiredTimes } from "../src/schedules";',
					line,
				],
			}),
		).toEqual([twin(engineTest)]);
	});

	test("a lone contract test fails, and one of another port that uses the real one passes", async () => {
		const lone = `${OUT}/fired-times.contract.test.ts`;
		expect(
			await check({
				...files,
				[lone]: [REAL, "expect(drizzleFiredTimes()).toBeDefined();"],
			}),
		).toEqual([suite(lone)]);
		const other = `${OUT}/times.contract.ts`;
		expect(
			await check({
				...files,
				[other]: [
					IMPORT,
					"export const timesContract = (make: () => FiredTimes) => expect(make().last('a')).toBe(1);",
				],
			}),
		).toEqual([suite(other)]);
		const seeded = `${OUT}/schedule-store.contract.test.ts`;
		expect(
			await check({
				...files,
				[seeded]: [
					...(repository[seeded] as string[]),
					REAL,
					"drizzleFiredTimes();",
				],
			}),
		).toEqual([]);
	});

	for (const [how, lines] of [
		[
			"a spread with a member that fails",
			[
				IMPORT,
				REAL,
				"export const log: FiredTimes = { ...drizzleFiredTimes(), last: () => { throw new Error(); } };",
			],
		],
		[
			"a spread of a port that comes in",
			[
				IMPORT,
				"export const failing = (real: FiredTimes): FiredTimes => ({ ...real, last: () => { throw new Error(); } });",
			],
		],
		[
			"a count of each call",
			[
				IMPORT,
				REAL,
				"const real = drizzleFiredTimes();",
				"export const log: FiredTimes = { last: (id) => real.last(id) };",
			],
		],
		[
			"one that opens late",
			[
				IMPORT,
				REAL,
				"const open = async () => drizzleFiredTimes();",
				"export const log = { last: async (id: string) => (await open()).last(id) } satisfies FiredTimes;",
			],
		],
		[
			"a count of a port that comes in",
			[
				IMPORT,
				"export const counted = (store: FiredTimes): FiredTimes => ({ last: (id) => store.last(id) });",
			],
		],
		[
			"one that a name made later gives",
			[
				IMPORT,
				REAL,
				"const outer = () => inner();",
				"const inner = () => drizzleFiredTimes();",
				"export const log: FiredTimes = { last: (id) => outer().last(id) };",
			],
		],
		[
			"a class over it",
			[
				IMPORT,
				"export class Log implements FiredTimes { last(id: string) { return real().last(id); } }",
				REAL,
				"const real = () => drizzleFiredTimes();",
			],
		],
		[
			"a fake of another port",
			[
				'import type { ScheduleStore } from "../../application/ports";',
				REAL,
				"export const store: ScheduleStore = { save: async () => {} };",
				"drizzleFiredTimes();",
			],
		],
		[
			"a type of the same name",
			[
				"type FiredTimes = { last(): number };",
				`export const log: FiredTimes = ${made};`,
				REAL,
				"drizzleFiredTimes();",
			],
		],
		[
			"a value of a method's type",
			[
				IMPORT,
				'export const id: Parameters<FiredTimes["last"]>[0] = "a";',
				"export const at: { last: number } = { last: 1 };",
			],
		],
	] as const)
		test(`passes: ${how}`, async () => {
			expect(
				await check({ ...files, [`${OUT}/log.test.ts`]: [...lines] }),
			).toEqual([]);
		});

	test("a use-case test reaches the database only through a port: it names no handle", async () => {
		for (const line of [
			"const { db, ...ports } = schedulePorts() as never;",
			"const { database, ...ports } = schedulePorts() as never;",
			'const ports = schedulePorts() as never; ports["db"].run();',
			'const { "database": rows, ...ports } = schedulePorts() as never;',
			'const { ["db"]: rows, ...ports } = schedulePorts() as never;',
			"const ports = schedulePorts() as never; ports[`db`].run();",
		]) {
			const TEST = `${SLICE}/application/list-schedules.test.ts`;
			expect(
				await check({
					...files,
					[TEST]: [
						'import { schedulePorts } from "../test-support";',
						'import { listSchedules } from "./list-schedules";',
						line,
						'expect(listSchedules(ports)("a")).toBe(2);',
					],
				}),
			).toEqual([
				`${TEST}: names the database. A use-case test reaches it only through a port: give the rows a function of test-support.ts.`,
			]);
		}
	});
});
