import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	readSchedulesFile,
	schedulesPath,
	writeFlowFile,
	writeSchedulesFile,
} from "./files";
import { singleAgentFlow } from "./quick";
import {
	cronError,
	cronToTimeAndDays,
	describeCron,
	latestCronTime,
	nextCronTimes,
	nextTimeOfDay,
	type Schedule,
	type ScheduleFlowInfo,
	scheduleSchema,
	schedulesFileSchema,
	timeAndDaysToCron,
	validateSchedules,
} from "./schedules";
import type { Flow } from "./schema";

/** Local time, the daemon's clock. */
const at = (day: number, hours: number, minutes = 0) =>
	new Date(2026, 9, day, hours, minutes).getTime();

const schedule = (extra: Partial<Schedule> = {}): Schedule => ({
	id: "night",
	flow: "night",
	inputs: {},
	cron: "0 22 * * *",
	enabled: true,
	...extra,
});

describe("scheduleSchema", () => {
	test("applies defaults", () => {
		expect(
			scheduleSchema.parse({ id: "night", flow: "night", cron: "0 22 * * *" }),
		).toEqual({
			id: "night",
			flow: "night",
			inputs: {},
			cron: "0 22 * * *",
			enabled: true,
		});
	});

	test("refuses a bad id, a bad stop time and an empty cron line", () => {
		const result = scheduleSchema.safeParse({
			id: "Night!",
			flow: "night",
			cron: " ",
			stopAt: "7:00",
		});
		expect(result.success).toBe(false);
		expect(result.error?.issues.map((i) => i.path[0]).sort()).toEqual([
			"cron",
			"id",
			"stopAt",
		]);
	});

	test("the file has version 1", () => {
		expect(schedulesFileSchema.safeParse({ version: 2 }).success).toBe(false);
		expect(schedulesFileSchema.parse({ version: 1 })).toEqual({
			version: 1,
			schedules: [],
		});
	});
});

describe("cron helpers", () => {
	test("cronError explains a bad line and passes a good one", () => {
		expect(cronError("0 22 * * 1-5")).toBeNull();
		expect(cronError("61 22 * * *")).toContain("minute");
		expect(cronError("0 22 * *")).not.toBeNull();
		// Five fields only: no seconds.
		expect(cronError("0 0 22 * * *")).not.toBeNull();
	});

	test("nextCronTimes lists times strictly after the moment", () => {
		// 16 October 2026 is a Friday.
		expect(nextCronTimes("0 22 * * 1-5", at(16, 22), 3)).toEqual([
			at(19, 22),
			at(20, 22),
			at(21, 22),
		]);
		expect(nextCronTimes("0 22 * * *", at(16, 21, 59))).toEqual([at(16, 22)]);
		expect(nextCronTimes("nope", at(16, 22))).toEqual([]);
	});

	test("latestCronTime includes the moment itself", () => {
		expect(latestCronTime("0 22 * * *", at(16, 22))).toBe(at(16, 22));
		expect(latestCronTime("0 22 * * *", at(16, 22) + 500)).toBe(at(16, 22));
		expect(latestCronTime("0 22 * * *", at(16, 21, 59))).toBe(at(15, 22));
		expect(latestCronTime("nope", at(16, 22))).toBeNull();
	});

	test("nextTimeOfDay is later today, else tomorrow", () => {
		expect(nextTimeOfDay("07:00", at(16, 22))).toBe(at(17, 7));
		expect(nextTimeOfDay("23:00", at(16, 22))).toBe(at(16, 23));
		expect(nextTimeOfDay("22:00", at(16, 22))).toBe(at(17, 22));
		expect(nextTimeOfDay("7am", at(16, 22))).toBeNull();
	});

	test("time and days round-trip through a cron line", () => {
		expect(
			timeAndDaysToCron({ time: "22:00", days: [0, 1, 2, 3, 4, 5, 6] }),
		).toBe("0 22 * * *");
		expect(timeAndDaysToCron({ time: "06:30", days: [5, 1, 2, 3, 4] })).toBe(
			"30 6 * * 1-5",
		);
		expect(timeAndDaysToCron({ time: "06:30", days: [0, 6] })).toBe(
			"30 6 * * 0,6",
		);
		expect(timeAndDaysToCron({ time: "06:30", days: [] })).toBeNull();
		expect(cronToTimeAndDays("30 6 * * 1-5")).toEqual({
			time: "06:30",
			days: [1, 2, 3, 4, 5],
		});
		expect(cronToTimeAndDays("0 22 * * mon,fri")).toEqual({
			time: "22:00",
			days: [1, 5],
		});
		expect(cronToTimeAndDays("0 22 * * 5-7")).toEqual({
			time: "22:00",
			days: [0, 5, 6],
		});
		expect(cronToTimeAndDays("*/5 22 * * *")).toBeNull();
		expect(cronToTimeAndDays("0 22 1 * *")).toBeNull();
	});

	test("describeCron reads common shapes and falls back to the line", () => {
		expect(describeCron("0 22 * * *")).toBe("every day at 22:00");
		expect(describeCron("0 22 * * 1-5")).toBe("weekdays at 22:00");
		expect(describeCron("0 22 * * MON-FRI")).toBe("weekdays at 22:00");
		expect(describeCron("0 9 * * 0,6")).toBe("weekends at 09:00");
		expect(describeCron("30 6 * * 0,3,1")).toBe("Mon, Wed, Sun at 06:30");
		expect(describeCron("* * * * *")).toBe("every minute");
		expect(describeCron("*/15 * * * *")).toBe("every 15 minutes");
		expect(describeCron("5 * * * *")).toBe("every hour at :05");
		expect(describeCron("0 22 1 * *")).toBe("0 22 1 * *");
	});
});

describe("validateSchedules", () => {
	const flows: Record<string, ScheduleFlowInfo | null> = {
		night: {
			inputs: [
				{ name: "epic", type: "text", required: true },
				{ name: "limit", type: "text", default: "3" },
				{ name: "plan", type: "json" },
			],
			errorCount: 0,
		},
		broken: { inputs: [], errorCount: 2 },
		unreadable: null,
	};

	test("a good schedule has no issues", () => {
		expect(
			validateSchedules(
				[
					schedule({
						inputs: { epic: "42", plan: '{"tasks": []}' },
						stopAt: "07:00",
					}),
				],
				flows,
			),
		).toEqual([]);
	});

	test("reports each problem with the schedule id", () => {
		const issues = validateSchedules(
			[
				schedule({ id: "a", flow: "missing" }),
				schedule({ id: "b", flow: "unreadable" }),
				schedule({ id: "c", flow: "broken" }),
				schedule({ id: "d", cron: "0 25 * * *", inputs: { epic: "1" } }),
				schedule({ id: "e", inputs: { epic: " ", other: "x", plan: "{" } }),
				schedule({ id: "e", inputs: { epic: "1" } }),
			],
			flows,
		);
		expect(issues.map((i) => [i.scheduleId, i.message])).toEqual([
			["a", 'The flow "missing" does not exist.'],
			["b", 'The flow "unreadable" does not load.'],
			["c", 'The flow "broken" has 2 errors: it cannot run.'],
			["d", expect.stringContaining("The cron line does not parse")],
			["e", 'The flow "night" has no input "other".'],
			["e", 'The input "epic" needs a value.'],
			["e", 'The value of input "plan" is not valid JSON.'],
			["e", 'Another schedule has the id "e".'],
		]);
		expect(issues.every((i) => i.severity === "error")).toBe(true);
	});
});

describe("the schedules file", () => {
	let repo: string;
	beforeEach(async () => {
		repo = await mkdtemp(join(tmpdir(), "nightshift-schedules-"));
	});
	afterEach(async () => {
		await rm(repo, { recursive: true, force: true });
	});

	const flow = (): Flow => ({
		...singleAgentFlow({
			prompt: "Fix {{epic}}",
			model: "sonnet",
			permissionMode: "acceptEdits",
		}),
		inputs: [{ name: "epic", type: "text", required: true }],
	});

	test("is .nightshift/schedules.json", () => {
		expect(schedulesPath("/repo")).toBe(
			join("/repo", ".nightshift", "schedules.json"),
		);
	});

	test("a missing file is no schedules", async () => {
		expect(await readSchedulesFile(repo)).toEqual({
			path: schedulesPath(repo),
			schedules: [],
			issues: [],
		});
	});

	test("round-trips, as pretty JSON with a newline, with issues", async () => {
		await writeFlowFile(repo, "night", flow());
		const schedules = [
			schedule({ inputs: { epic: "42" }, stopAt: "07:00", baseRef: "main" }),
			schedule({ id: "other", flow: "gone", enabled: false }),
		];
		const issues = await writeSchedulesFile(repo, schedules);
		expect(issues).toEqual([
			{
				severity: "error",
				message: 'The flow "gone" does not exist.',
				scheduleId: "other",
			},
		]);
		const text = await readFile(schedulesPath(repo), "utf8");
		expect(text).toBe(
			`${JSON.stringify({ version: 1, schedules }, null, "\t")}\n`,
		);
		expect(await readSchedulesFile(repo)).toEqual({
			path: schedulesPath(repo),
			schedules,
			issues,
		});
		expect((await readSchedulesFile(repo, { validate: false })).issues).toEqual(
			[],
		);
	});

	test("checks the inputs against the flow file", async () => {
		await writeFlowFile(repo, "night", flow());
		expect(await writeSchedulesFile(repo, [schedule()])).toEqual([
			{
				severity: "error",
				message: 'The input "epic" needs a value.',
				scheduleId: "night",
			},
		]);
	});

	test("a file that is not JSON or not the schema loads empty with issues", async () => {
		await mkdir(join(repo, ".nightshift"), { recursive: true });
		await writeFile(schedulesPath(repo), "{ nope");
		const broken = await readSchedulesFile(repo);
		expect(broken.schedules).toEqual([]);
		expect(broken.issues[0]?.message).toStartWith("Not valid JSON");

		await writeFile(
			schedulesPath(repo),
			JSON.stringify({ version: 1, schedules: [{ id: "x" }] }),
		);
		const wrong = await readSchedulesFile(repo);
		expect(wrong.schedules).toEqual([]);
		expect(wrong.issues.map((i) => i.message)).toContain(
			"schedules.0.flow: Invalid input: expected string, received undefined",
		);
	});
});
