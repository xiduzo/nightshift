/**
 * The rules of ADR 41 (`scripts/rings/decides.ts`, and T1 of H7): each on
 * the small repository of the ring check's tests, red and green.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";

import {
	asserting,
	check as checkFiles,
	type Files,
	repository,
	SLICE,
} from "./fixture";

const roots: string[] = [];
afterAll(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const APP = `${SLICE}/application`;
const OUT = `${SLICE}/adapters/out`;
const USE_CASE = `${APP}/list-schedules.ts`;
const TEST = `${APP}/list-schedules.test.ts`;

/** The problems of the repository with `files`, and with `useCaseDebt`. */
const check = (files: Files, useCaseDebt = "") =>
	checkFiles({ ...repository, ...files }, roots, { useCaseDebt });

/** The problems of a use case `listSchedules` with these lines. */
const ofUseCase = (lines: string[], useCaseDebt?: string) =>
	check(
		{
			[USE_CASE]: lines,
			[TEST]: asserting("list-schedules", "listSchedules"),
		},
		useCaseDebt,
	);

const FORWARD = `${USE_CASE}: passes its request to one port call and decides nothing. The wire.ts of the slice gives that call.`;

describe("a forward is no use case", () => {
	for (const body of [
		"(ports: any) => async (request: any) => ports.store.list(request)",
		"(ports: any) => (request: any) => ports.store.list(request.id, request.page.at)",
		"(ports: any) => ({ id }: any) => ports.list(id)",
		"({ store }: any) => (request: any) => store.list({ id: request.id, all: [request.a] })",
		"(ports: any) => async (request: any) => { return await ports.store.list({ ...request }); }",
		"(ports: any) => async (request: any) => { await ports.store.list(request); }",
		"(ports: any) => async (request: any) => { const rows = await ports.store.list(request); return rows; }",
		"(ports: any) => () => ports.store.list()",
		"(ports: any) => ports.store.list",
		"(ports: any, request: any) => ports.store.list(request)",
		"(ports: any) => (request: any) => (ports.store.list(request) as any)!",
	])
		test(`fails: ${body}`, async () => {
			expect(
				await ofUseCase([`export const listSchedules = ${body};`]),
			).toEqual([FORWARD]);
		});

	test("fails: a declaration", async () => {
		expect(
			await ofUseCase([
				"export function listSchedules(ports: any) {",
				"\treturn (request: any) => ports.store.list(request);",
				"}",
			]),
		).toEqual([FORWARD]);
	});

	for (const body of [
		// A mapping: a choice of its own.
		"(ports: any) => (request: any) => ports.store.list(request, 10)",
		"(ports: any) => (request: any) => ports.store.list(request.ids ?? [])",
		"(ports: any) => (request: any) => ports.store.list([])",
		"(ports: any) => (request: any) => ports.store.list(ports.clock())",
		"(ports: any) => async (request: any) => (await ports.store.list(request)).rows",
		// A check: the actor reaches the call.
		"(ports: any) => (actor: any, request: any) => ports.access.openSpace(actor, { spaceId: request.spaceId })",
		// Two effects, a refusal, a computation.
		"(ports: any) => async (request: any) => { await ports.a(request); await ports.b(request); }",
		"(ports: any) => (request: any) => { if (!request.id) throw new Error(); return ports.list(request); }",
		"(ports: any) => (request: any) => listed(request)",
	])
		test(`passes: ${body}`, async () => {
			expect(
				await ofUseCase([
					"const listed = (request: any) => request;",
					`export const listSchedules = ${body};`,
				]),
			).toEqual([]);
		});
});

describe("a use case that takes the Actor reads it", () => {
	const message = (names: string) =>
		`${USE_CASE}: takes the actor (${names}) and does not read it. Ask who may act, or take no actor.`;
	for (const [parameter, body, names] of [
		["_actor: any", "request.id + 1", "_actor"],
		["_actor: any", "_actor.id + 1", "_actor"],
		["actor: any", "request.id + 1", "actor"],
		["actor: any", "request.actor + 1", "actor"],
		["actor: any", "(void actor, request.id + 1)", "actor"],
		["who: Actor", "request.id + 1", "who"],
		["{ personId }: Actor", "request.id + 1", "personId"],
	] as const)
		test(`fails: ${parameter}, ${body}`, async () => {
			expect(
				await ofUseCase([
					'import type { Actor } from "../../contract";',
					`export const listSchedules = (ports: any) => (${parameter}, request: any) => ${body};`,
					"export type Who = Actor;",
				]),
			).toEqual([message(names)]);
		});

	for (const [parameter, body] of [
		["actor: Actor", "ports.mayList(actor, request)"],
		["actor: Actor", "({ actor, ...request })"],
		["{ personId }: Actor", "request.id + personId"],
		// The type of a port's method is no parameter of a use case.
		["actor: Actor, ask: (actor: Actor) => boolean", "ask(actor)"],
	] as const)
		test(`passes: ${parameter}, ${body}`, async () => {
			expect(
				await ofUseCase([
					'import type { Actor } from "../../contract";',
					`export const listSchedules = (ports: any) => (${parameter}, request: any) => ${body};`,
				]),
			).toEqual([]);
		});
});

describe("a use-case test asserts an outcome", () => {
	const lines = ["export const listSchedules = (ports: any) => [ports];"];
	const ofTest = (text: string, debt?: string) =>
		check(
			{
				[USE_CASE]: lines,
				[TEST]: `import { listSchedules } from "./list-schedules";\n${text}\n`,
			},
			debt,
		);
	const message = `${TEST}: asserts no outcome of listSchedules. Expect what it returns, refuses or changes.`;
	for (const text of [
		"",
		'test("x", () => listSchedules({}));',
		'expect(typeof listSchedules).toBe("function");',
		'expect(typeof listSchedules === "function").toBe(true);',
		"expect(listSchedules).toBeDefined();",
	])
		test(`fails: ${text || "no expect"}`, async () => {
			expect(await ofTest(text)).toEqual([message]);
		});

	test("passes: one expect of a result", async () => {
		expect(
			await ofTest(
				'expect(typeof listSchedules).toBe("function");\nexpect(listSchedules({})).toEqual([{}]);',
			),
		).toEqual([]);
	});

	test("the list names it, until it asserts", async () => {
		const debt = `empty-test ${TEST}\n`;
		expect(await ofTest("", debt)).toEqual([]);
		expect(await ofTest("expect(listSchedules({}));", debt)).toEqual([
			`scripts/use-case-debt.txt: empty-test ${TEST} breaks no rule. Remove it.`,
		]);
	});
});

describe("a port sits in ports.ts", () => {
	const declaring = (type: string, bag: string) =>
		ofUseCase([
			type,
			`export type ListSchedulesPorts = ${bag};`,
			"export const listSchedules = (ports: ListSchedulesPorts) => [ports];",
		]);
	const message = `${USE_CASE}: declares the port Reader. A port sits in application/ports.ts, with its adapters.`;

	for (const [type, bag] of [
		["export type Reader = (id: string) => string;", "{ reader: Reader }"],
		["interface Reader { read(id: string): string }", "{ reader: Reader }"],
		["type Reader = { read(): string };", "{ open(): Promise<Reader> }"],
		["type Reader = { read(): string };", "object & { r?: Reader }"],
	] as const)
		test(`fails: ${type} in ${bag}`, async () => {
			expect(await declaring(type, bag)).toEqual([message]);
		});

	for (const [type, bag] of [
		// Data, and a function written in the bag itself: the clock, a new id.
		["type Reader = { id: string };", "{ list(): Reader[] }"],
		["type Reader = { read(): string };", "{ now: () => number }"],
		["type Reader = { read(): string };", "Reader"],
	] as const)
		test(`passes: ${type} in ${bag}`, async () => {
			expect(await declaring(type, bag)).toEqual([]);
		});
});

describe("a contract suite asserts, and a twin takes no code of a real adapter", () => {
	const SUITE = `${OUT}/schedule-store.contract.ts`;
	const TWIN = `${OUT}/in-memory-schedule-store.ts`;
	const suite = (line: string) =>
		check({
			[SUITE]: [
				'import type { ScheduleStore } from "../../application/ports";',
				"export function scheduleStoreContract(make: () => ScheduleStore): void {",
				`\t${line}`,
				"}",
			],
		});

	test("a suite without an outcome fails, and one expect passes", async () => {
		const problems = [
			`${SUITE}: a contract suite without an expect() proves nothing. Expect what the port gives.`,
		];
		expect(await suite("make();")).toEqual(problems);
		expect(await suite('expect(typeof make().save).toBe("function");')).toEqual(
			problems,
		);
		expect(await suite("expect(make().save({} as never));")).toEqual([]);
	});

	const twin = (line: string, debt = "") =>
		check(
			{
				[`${OUT}/rows.ts`]: "export const rows = [];\nexport type Row = 1;\n",
				[TWIN]: [
					'import type { ScheduleStore } from "../../application/ports";',
					line,
					"export const inMemoryScheduleStore = (): ScheduleStore => ({ save: async () => {} });",
				],
			},
			debt,
		);

	test("a value fails, a type passes", async () => {
		const problems = [
			`${TWIN}: takes code of a real adapter (${OUT}/rows.ts). The contract suite then runs that code twice. Move a value that both need to domain/.`,
		];
		expect(await twin('import { rows } from "./rows";')).toEqual(problems);
		expect(await twin('import { type Row, rows } from "./rows";')).toEqual(
			problems,
		);
		expect(await twin('import * as all from "./rows";')).toEqual(problems);
		expect(await twin('import type { Row } from "./rows";')).toEqual([]);
		expect(await twin('import { type Row } from "./rows";')).toEqual([]);
	});

	test("the list names it, until it takes no code", async () => {
		const debt = `twin ${TWIN}\n`;
		expect(await twin('import { rows } from "./rows";', debt)).toEqual([]);
		expect(await twin("", debt)).toEqual([
			`scripts/use-case-debt.txt: twin ${TWIN} breaks no rule. Remove it.`,
		]);
	});
});

describe("a twin has a reader (H7)", () => {
	const PORTS = `${APP}/ports.ts`;
	/** `FiredTimes`, with its real adapter, its suite, and the test on the real one. */
	const own = (twin: boolean): Files => ({
		[PORTS]: [
			'import type { Schedule } from "../domain/schedule";',
			"export type ScheduleStore = { save(schedule: Schedule): Promise<void> };",
			"export type FiredTimes = { last(id: string): number };",
		],
		[`${OUT}/drizzle-fired-times.ts`]: [
			'import type { FiredTimes } from "../../application/ports";',
			"export const drizzleFiredTimes = (): FiredTimes => ({ last: () => 1 });",
		],
		[`${OUT}/in-memory-fired-times.ts`]: twin
			? [
					'import type { FiredTimes } from "../../application/ports";',
					"export const inMemoryFiredTimes = (): FiredTimes => ({ last: () => 1 });",
				]
			: null,
		[`${OUT}/fired-times.contract.ts`]: [
			'import type { FiredTimes } from "../../application/ports";',
			"export function firedTimesContract(make: () => FiredTimes): void {",
			'\texpect(make().last("a")).toBe(1);',
			"}",
		],
		[`${OUT}/fired-times.contract.test.ts`]: [
			'import { drizzleFiredTimes } from "./drizzle-fired-times";',
			...(twin
				? ['import { inMemoryFiredTimes } from "./in-memory-fired-times";']
				: []),
			'import { firedTimesContract } from "./fired-times.contract";',
			"firedTimesContract(drizzleFiredTimes);",
			...(twin ? ["firedTimesContract(inMemoryFiredTimes);"] : []),
		],
	});
	const reading = (body: string): Files => ({
		[USE_CASE]: [
			'import type { FiredTimes } from "./ports";',
			`export const listSchedules = (ports: { times: FiredTimes }) => (id: string) => ${body};`,
		],
		[TEST]: asserting("list-schedules", "listSchedules"),
	});
	const unread = `${OUT}/in-memory-fired-times.ts: no use case reads FiredTimes, and nothing but its contract test imports this in-memory adapter. Remove it: the suite runs on the real adapter alone.`;

	test("no reader: a suite on the real adapter passes, a twin fails", async () => {
		expect(await check(own(false))).toEqual([]);
		expect(await check(own(true))).toEqual([unread]);
	});

	test("a use case reads it: it needs its twin, and the suite runs on both", async () => {
		const decides = reading("ports.times.last(id) + 1");
		expect(await check({ ...own(true), ...decides })).toEqual([]);
		expect(await check({ ...own(false), ...decides })).toEqual([
			`${PORTS}: the port FiredTimes is read by a use case and has no in-memory adapter. Add adapters/out/in-memory-fired-times.ts. If another slice or package implements the port, write @filledBy <who> in its comment.`,
			`${OUT}/fired-times.contract.test.ts: runs the contract suite on both adapters, but it does not import ./in-memory-fired-times.`,
		]);
	});

	test("a forward is no reader", async () => {
		const problems = await check({
			...own(true),
			...reading("ports.times.last(id)"),
		});
		expect(problems.sort()).toEqual([unread, FORWARD].sort());
	});

	test("the test of another slice reads the twin", async () => {
		expect(
			await check({
				...own(true),
				"packages/engine/src/gates/index.ts":
					'export { mayAnswer } from "./domain/answer";\n',
				"packages/engine/src/gates/domain/answer.ts":
					"export const mayAnswer = (status: string) => status.length > 0;\n",
				"packages/engine/src/gates/gates.test.ts": [
					'import { inMemoryFiredTimes } from "../schedules/adapters/out/in-memory-fired-times";',
					"inMemoryFiredTimes();",
				],
			}),
		).toEqual([]);
	});
});

describe("the list of the use cases", () => {
	const lines = [
		"export const listSchedules = (ports: any) => (id: any) => ports.find(id);",
	];

	test("a listed forward passes", async () => {
		expect(await ofUseCase(lines, `# why\nforward ${USE_CASE}\n`)).toEqual([]);
	});

	test("a line of a file that breaks no rule, twice, or of another rule fails", async () => {
		expect(
			await ofUseCase(
				lines,
				[
					`forward ${USE_CASE}`,
					`forward ${USE_CASE}`,
					`forward ${APP}/gone.ts`,
					`actor ${USE_CASE}`,
				].join("\n"),
			),
		).toEqual([
			`scripts/use-case-debt.txt: forward ${USE_CASE} is listed twice.`,
			`scripts/use-case-debt.txt: forward ${APP}/gone.ts breaks no rule. Remove it.`,
			`scripts/use-case-debt.txt: actor ${USE_CASE} is not <forward, empty-test or twin> <file>. Remove it.`,
		]);
	});

	test("an actor that is not read has no list", async () => {
		const problems = await ofUseCase(
			[
				"export const listSchedules = (ports: any) => (_actor: any) => [ports];",
			],
			`actor ${USE_CASE}\n`,
		);
		expect(problems).toHaveLength(2);
	});
});
