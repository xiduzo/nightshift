import { describe, expect, test } from "bun:test";
import type { Schedule } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import { atLocal } from "@nightshift/time/testing";
import { type Actor, NIGHT_SHIFT } from "../../contract";
import { inMemorySchedulePorts } from "../adapters/out/in-memory-neighbours";
import { createScheduleWatch } from "../domain/schedule-watch";
import { fireDueSchedules } from "./fire-due-schedules";
import { runScheduleNow } from "./run-schedule-now";

/** Run now, on in-memory adapters. */

/** Local time on the computer's clock, October 2026 (the 16th is a Friday). */
function at(day: number, hours: number, minutes = 0, seconds = 0): number {
	return atLocal(2026, 9, day, hours, minutes, seconds);
}

const P = "project-1";
const SPACE = "space-1";
const ANN: Actor = { personId: "person-ann" };

function nightly(extra: Partial<Schedule> = {}): Schedule {
	return {
		id: "nightly",
		flow: "night",
		inputs: {},
		cron: "0 22 * * *",
		enabled: true,
		...extra,
	};
}

/** A project in a Space with `schedules`, at `now`. */
function project(schedules: Schedule[], now = at(16, 12)) {
	const ports = inMemorySchedulePorts(now);
	ports.projects.add({ id: P, spaceId: SPACE });
	ports.store.seed(P, { schedules });
	const runNow = runScheduleNow(ports);
	return {
		ports,
		runNow: (scheduleId: string) =>
			runNow(ANN, { spaceId: SPACE, projectId: P, scheduleId }),
		/** As a caller without a person: an in-process one. */
		runNowAsNobody: (scheduleId: string) =>
			runNow(undefined, { spaceId: SPACE, projectId: P, scheduleId }),
		runNowIn: (spaceId: string) =>
			runNow(ANN, { spaceId, projectId: P, scheduleId: "nightly" }),
	};
}

/** What a request refuses with, or null. */
const refusalOf = (work: Promise<unknown>) =>
	work.then(
		() => null,
		(error: unknown) => error,
	);

describe("Run now", () => {
	test("starts the schedule's run at once, with its inputs and the schedule as the trigger", async () => {
		const { ports, runNow } = project([
			nightly({ inputs: { epic: "42" }, stopAt: "07:00", baseRef: "main" }),
		]);
		const run = await runNow("nightly");
		expect(ports.runs.started).toHaveLength(1);
		expect(ports.runs.started[0]).toMatchObject({
			input: {
				projectId: P,
				flowName: "night",
				inputs: { epic: "42" },
				baseRef: "main",
				// The first 07:00 after now.
				stopAt: at(17, 7),
			},
			// It fires as if its time were now.
			trigger: { kind: "schedule", scheduleId: "nightly", at: at(16, 12) },
		});
		expect(run).toBe(ports.runs.started[0]?.run as typeof run);
		expect(ports.log.facts.schedule).toEqual([
			{
				kind: "fired",
				projectId: P,
				scheduleId: "nightly",
				at: at(16, 12),
				runId: run.id,
				error: null,
			},
		]);
	});

	test("the run is the schedule's Person's, else the person's who asks", async () => {
		const { ports, runNow, runNowAsNobody } = project([
			nightly({ id: "mine" }),
			nightly({ id: "carols", person: "person-carol" }),
			nightly({ id: "nobodys" }),
		]);
		await runNow("mine");
		await runNow("carols");
		await runNowAsNobody("nobodys");
		expect(ports.runs.started.map((start) => start.input.startedBy)).toEqual([
			"person-ann",
			"person-carol",
			undefined,
		]);
	});

	test("tonight's start still fires after it, and a pause tonight stays", async () => {
		const paused = nightly({ id: "paused", pausedUntil: at(17, 6) });
		const { ports, runNow } = project([nightly(), paused]);
		const look = fireDueSchedules({
			...ports,
			watch: createScheduleWatch(ports.clock()),
		});
		const idle = { held: () => false, stopped: () => false };
		await look(idle);
		await runNow("nightly");
		await runNow("paused");
		ports.runs.setStatus("run-1", "finished");
		ports.runs.setStatus("run-2", "finished");
		expect(
			(await ports.store.list(P, { validate: false })).schedules[1],
		).toEqual(paused);

		ports.clock.set(at(16, 22, 0, 20));
		await look(idle);
		expect(
			ports.log.facts.schedule.map((fact) => [
				fact.kind,
				fact.scheduleId,
				fact.at,
			]),
		).toEqual([
			["fired", "nightly", at(16, 12)],
			["fired", "paused", at(16, 12)],
			["fired", "nightly", at(16, 22)],
			["skipped", "paused", at(16, 22)],
		]);
	});

	test("refuses while an earlier run of the schedule is open, and starts nothing", async () => {
		const { ports, runNow } = project([nightly()]);
		await runNow("nightly");
		ports.runs.setStatus("run-1", "waiting");
		const refused = await refusalOf(runNow("nightly"));
		expect(refused).toBeInstanceOf(Refusal);
		expect(refused).toMatchObject({
			kind: "conflict",
			message:
				"An earlier run of this schedule is still waiting. Wait for it to end, or stop it.",
		});
		expect(ports.runs.started).toHaveLength(1);

		// Once it ended, Run now works again.
		ports.runs.setStatus("run-1", "stopped");
		await runNow("nightly");
		expect(ports.runs.started).toHaveLength(2);
	});

	test("refuses a schedule that does not exist, and one that starts no flow", async () => {
		const { ports, runNow } = project([
			{ id: "signal-only", inputs: {}, enabled: true },
		]);
		expect(await refusalOf(runNow("gone"))).toMatchObject({
			kind: "not-found",
			message: "This schedule does not exist. Someone may have removed it.",
		});
		expect(await refusalOf(runNow("signal-only"))).toMatchObject({
			kind: "invalid",
			message: "This schedule starts no flow.",
		});
		expect(ports.runs.started).toEqual([]);
		expect(ports.log.facts.schedule).toEqual([]);
	});

	test("a project of another Space is not found, before anyone is asked anything", async () => {
		const { ports, runNowIn } = project([nightly()]);
		expect(await refusalOf(runNowIn("space-2"))).toMatchObject({
			kind: "not-found",
		});
		expect(ports.runs.shown).toEqual([]);
		expect(ports.runs.started).toEqual([]);
	});

	test("asks who may see the run before it starts it, and shows the run as that says", async () => {
		const { ports, runNow } = project([nightly()]);
		ports.runs.hidePaths();
		// The start sees that the question came first.
		const start = ports.runs.start;
		let askedBeforeStart = 0;
		ports.runs.start = async (input, trigger) => {
			askedBeforeStart = ports.runs.shown.length;
			return start(input, trigger);
		};
		const run = await runNow("nightly");
		expect(askedBeforeStart).toBe(1);
		expect(ports.runs.shown).toEqual([{ spaceId: SPACE, actor: ANN }]);
		expect(run.worktreePath).toBe("");
		expect(ports.runs.started[0]?.run.worktreePath).not.toBe("");
	});

	test("what the start refuses passes through, and nothing is logged", async () => {
		const { ports, runNow } = project([nightly()]);
		const cap = new Refusal("conflict", "The run cap is reached.");
		ports.runs.failNextStart(cap);
		expect(await refusalOf(runNow("nightly"))).toBe(cap);
		expect(ports.log.facts.schedule).toEqual([]);
	});

	test("asks whether the person may start runs in the Space, before it reads anything", async () => {
		const { ports, runNow, runNowAsNobody } = project([nightly()]);
		ports.runs.refuseStarts(new Refusal("forbidden", "Your role cannot."));
		expect(await refusalOf(runNow("nightly"))).toMatchObject({
			kind: "forbidden",
			message: "Your role cannot.",
		});
		expect(ports.runs.askedToStart).toEqual([{ actor: ANN, spaceId: SPACE }]);
		expect(ports.runs.shown).toEqual([]);
		expect(ports.runs.started).toEqual([]);
		expect(ports.log.facts.schedule).toEqual([]);

		// A caller in this process acts as Night Shift: no role applies.
		await runNowAsNobody("nightly");
		expect(ports.runs.askedToStart[1]).toEqual({
			actor: NIGHT_SHIFT,
			spaceId: SPACE,
		});
		expect(ports.runs.started).toHaveLength(1);
	});

	test("asks the role before it looks for the project", async () => {
		const { ports, runNowIn } = project([nightly()]);
		ports.runs.refuseStarts(new Refusal("not-found", "No such Space."));
		expect(await refusalOf(runNowIn("space-2"))).toMatchObject({
			message: "No such Space.",
		});
		expect(ports.runs.askedToStart).toEqual([
			{ actor: ANN, spaceId: "space-2" },
		]);
	});

	test("works while the scheduler is switched off", async () => {
		const { ports, runNow } = project([nightly()]);
		ports.switch.turn(false);
		ports.switch.start(false);
		await runNow("nightly");
		expect(ports.runs.started).toHaveLength(1);
	});
});
