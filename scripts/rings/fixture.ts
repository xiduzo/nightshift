/**
 * A small repository for the tests of the ring check: one slice in shape,
 * a kernel mechanism, another mechanism, a vertical on the debt list, the
 * shared kernel packages and the database package.
 */
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { checkRings, type Options } from "../check-rings";

/** A path and its source. `null` leaves the file out. */
export type Files = Record<string, string | string[] | null>;

/**
 * Writes `files` to a new root, and links each package into
 * `node_modules/@nightshift/`, as Bun does for a workspace. The root goes
 * on `roots`, for the test to remove.
 */
export function write(files: Files, roots: string[]): string {
	const root = mkdtempSync(join(tmpdir(), "check-rings-"));
	roots.push(root);
	for (const [path, text] of Object.entries(files)) {
		if (text === null) continue;
		const full = join(root, path);
		mkdirSync(dirname(full), { recursive: true });
		writeFileSync(
			full,
			typeof text === "string" ? text : `${text.join("\n")}\n`,
		);
		const workspace = /^packages\/([^/]+)\/package\.json$/.exec(path);
		if (workspace) {
			const scope = join(root, "node_modules", "@nightshift");
			mkdirSync(scope, { recursive: true });
			symlinkSync(
				join(root, "packages", workspace[1] as string),
				join(scope, workspace[1] as string),
			);
		}
	}
	return root;
}

/** The debt list and the mechanisms of `repository`. */
export const DEFAULTS: Options = {
	debt: "engine/projects\n",
	mechanisms: ["engine/contract", "engine/log", "agents/port"],
};

/** The problems of the repository in `files`, with DEFAULTS and `options`. */
export function check(
	files: Files,
	roots: string[],
	options: Partial<Options> = {},
): Promise<string[]> {
	return checkRings(write(files, roots), { ...DEFAULTS, ...options });
}

export const manifest = (name: string, exports: Record<string, string>) =>
	JSON.stringify({ name: `@nightshift/${name}`, exports });

/** The slice in shape. */
export const SLICE = "packages/engine/src/schedules";

/**
 * `engine/schedules` is in shape. `engine/contract` is the kernel of the
 * engine, `engine/log` is a mechanism that is not kernel, and
 * `engine/projects` is on the debt list. `agents` is another package, with
 * its `./types` entry (the mechanism `agents/port`).
 */
export const repository: Files = {
	"packages/time/package.json": manifest("time", {
		".": "./src/index.ts",
		"./cron": "./src/cron.ts",
		"./testing": "./src/testing/index.ts",
	}),
	"packages/time/src/index.ts": "export const now = () => 0;\n",
	"packages/time/src/cron.ts":
		"export const nextTime = (line: string) => line.length;\n",
	"packages/time/src/testing/index.ts":
		"export const utc = (text: string) => text.length;\n",
	"packages/refusal/package.json": manifest("refusal", {
		".": "./src/index.ts",
	}),
	"packages/refusal/src/index.ts": "export class Refusal extends Error {}\n",
	"packages/flows/package.json": manifest("flows", {
		".": "./src/index.ts",
		"./json-schema": "./src/json-schema.ts",
	}),
	"packages/flows/src/index.ts": "export type Flow = { id: string };\n",
	"packages/flows/src/json-schema.ts":
		"export const dataProblem = () => undefined;\n",
	"packages/db/package.json": manifest("db", { ".": "./src/index.ts" }),
	"packages/db/src/index.ts": "export type Database = { run(): void };\n",
	"packages/auth/package.json": manifest("auth", { ".": "./src/index.ts" }),
	"packages/auth/src/index.ts": "export const membersOf = () => [];\n",
	"packages/agents/package.json": manifest("agents", {
		".": "./src/index.ts",
		"./types": "./src/port/index.ts",
	}),
	"packages/agents/src/index.ts": "export const harnesses = [];\n",
	"packages/agents/src/port/index.ts": [
		"export type Harness = { id: string };",
		"export const shellQuote = (text: string) => text;",
	],
	"packages/engine/package.json": manifest("engine", {
		".": "./src/index.ts",
	}),
	"packages/engine/src/index.ts":
		'export { wireSchedules } from "./schedules";\n',
	"packages/engine/src/contract/index.ts":
		'export { type Actor, permissionOf } from "./actor";\n',
	"packages/engine/src/contract/actor.ts": [
		"export type Actor = { personId: string };",
		"export const permissionOf = (actor: Actor) => actor.personId.length;",
	],
	"packages/engine/src/log/index.ts":
		'export { appendEvent, type LoggedEvent } from "./run-log";\n',
	"packages/engine/src/log/run-log.ts": [
		'import type { Database } from "@nightshift/db";',
		"export type LoggedEvent = { seq: number };",
		"export const appendEvent = (db: Database) => db.run();",
	],
	"packages/engine/src/projects/index.ts":
		'export { projectOf } from "./project";\n',
	"packages/engine/src/projects/project.ts":
		"export const projectOf = (id: string) => id;\n",
	[`${SLICE}/index.ts`]: [
		'export type { Schedule } from "./domain/schedule";',
		'export { wireSchedules } from "./wire";',
	],
	[`${SLICE}/wire.ts`]: [
		'import type { Database } from "@nightshift/db";',
		'import { drizzleScheduleStore } from "./adapters/out/drizzle-schedule-store";',
		'import { createSchedule } from "./application/create-schedule";',
		"export type Schedules = { create: ReturnType<typeof createSchedule> };",
		"export function wireSchedules(deps: { db: Database }): Schedules {",
		"\treturn {",
		"\t\tcreate: createSchedule({ schedules: drizzleScheduleStore(deps.db) }),",
		"\t};",
		"}",
	],
	[`${SLICE}/wire.test.ts`]: [
		'import { expect, test } from "bun:test";',
		'import { wireSchedules } from "./wire";',
		'test("it wires", () => expect(wireSchedules).toBeDefined());',
	],
	[`${SLICE}/domain/schedule.ts`]: [
		'import type { Flow } from "@nightshift/flows";',
		'import { Refusal } from "@nightshift/refusal";',
		'import { nextTime } from "@nightshift/time/cron";',
		'import { z } from "zod";',
		'import { type Actor, permissionOf } from "../../contract";',
		"export const scheduleSchema = z.object({ cron: z.string() });",
		"export type Schedule = { cron: string; owner: Actor; flow: Flow };",
		"export function nextRun(schedule: Schedule): number {",
		"\tif (!permissionOf(schedule.owner)) throw new Refusal();",
		"\treturn nextTime(schedule.cron);",
		"}",
	],
	[`${SLICE}/domain/schedule.test.ts`]: [
		'import { expect, test } from "bun:test";',
		'import { utc } from "@nightshift/time/testing";',
		'import { nextRun } from "./schedule";',
		'test("next run", () => expect(nextRun).toBeDefined() && utc("x"));',
	],
	[`${SLICE}/application/ports.ts`]: [
		'import type { Schedule } from "../domain/schedule";',
		"export type ScheduleStore = {",
		"\tsave(schedule: Schedule): Promise<void>;",
		"};",
	],
	[`${SLICE}/application/create-schedule.ts`]: [
		'import { now } from "@nightshift/time";',
		'import { type Actor, permissionOf } from "../../contract";',
		'import type { LoggedEvent } from "../../log";',
		'import { projectOf } from "../../projects";',
		'import { nextRun, type Schedule } from "../domain/schedule";',
		'import type { ScheduleStore } from "./ports";',
		"export type CreateSchedulePorts = { schedules: ScheduleStore };",
		"export type Created = { at: number; event?: LoggedEvent };",
		"export const createSchedule =",
		"\t(ports: CreateSchedulePorts) =>",
		"\tasync (actor: Actor, schedule: Schedule): Promise<Created> => {",
		"\t\tawait ports.schedules.save(schedule);",
		"\t\tconst owner = projectOf(actor.personId).length + permissionOf(actor);",
		"\t\treturn { at: nextRun(schedule) + now() + owner };",
		"\t};",
	],
	[`${SLICE}/application/create-schedule.test.ts`]: [
		'import { expect, test } from "bun:test";',
		'import { inMemoryScheduleStore } from "../adapters/out/in-memory-schedule-store";',
		'import { createSchedule } from "./create-schedule";',
		'test("it saves", () => expect(createSchedule({ schedules: inMemoryScheduleStore() })).toBeDefined());',
	],
	[`${SLICE}/adapters/out/in-memory-schedule-store.ts`]: [
		'import type { ScheduleStore } from "../../application/ports";',
		"export function inMemoryScheduleStore(): ScheduleStore {",
		"\treturn { save: async () => {} };",
		"}",
	],
	[`${SLICE}/adapters/out/drizzle-schedule-store.ts`]: [
		'import type { Database } from "@nightshift/db";',
		'import { eq } from "drizzle-orm";',
		'import type { ScheduleStore } from "../../application/ports";',
		'import { appendEvent } from "../../../log";',
		"export function drizzleScheduleStore(db: Database): ScheduleStore {",
		"\treturn { save: async () => appendEvent(db) ?? eq };",
		"}",
	],
	[`${SLICE}/adapters/out/schedule-store.contract.ts`]: [
		'import { expect, test } from "bun:test";',
		'import type { ScheduleStore } from "../../application/ports";',
		"export function scheduleStoreContract(make: () => ScheduleStore): void {",
		'\ttest("it saves", () => expect(make()).toBeDefined());',
		"}",
	],
	[`${SLICE}/adapters/out/schedule-store.contract.test.ts`]: [
		'import type { Database } from "@nightshift/db";',
		'import { drizzleScheduleStore } from "./drizzle-schedule-store";',
		'import { inMemoryScheduleStore } from "./in-memory-schedule-store";',
		'import { scheduleStoreContract } from "./schedule-store.contract";',
		"scheduleStoreContract(inMemoryScheduleStore);",
		"scheduleStoreContract(() => drizzleScheduleStore({} as Database));",
	],
};

/** A second slice in shape, of `domain/` alone: `engine/gates`. */
export const gates: Files = {
	"packages/engine/src/gates/index.ts":
		'export { mayAnswer } from "./domain/answer";\n',
	"packages/engine/src/gates/domain/answer.ts":
		"export const mayAnswer = (status: string) => status.length > 0;\n",
};
