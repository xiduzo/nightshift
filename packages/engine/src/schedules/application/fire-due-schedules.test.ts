import { describe, expect, spyOn, test } from "bun:test";
import type { Schedule } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import { atLocal, utc } from "@nightshift/time/testing";
import type { UsageMoment } from "../../usage";
import { createScheduleWatch } from "../domain/schedule-watch";
import { schedulePorts } from "../test-support";
import { fireDueSchedules } from "./fire-due-schedules";

/**
 * One look of the scheduler, over a database in memory. A test sets the clock
 * and asks for a look: no timer.
 */

/** Local time on the computer's clock, October 2026 (the 16th is a Friday). */
function at(day: number, hours: number, minutes = 0, seconds = 0): number {
	return atLocal(2026, 9, day, hours, minutes, seconds);
}

const P = "project-1";
// biome-ignore lint/suspicious/noTemplateCurlyInString: a secret reference, as a person writes it.
const HOOK_SECRET = "${HOOK_SECRET}";

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

/** A daemon over the ports: its watch begins now, and its log reads the facts that are there. */
function daemon(ports: Awaited<ReturnType<typeof schedulePorts>>) {
	const usage: UsageMoment[] = [];
	const log = ports.openLog();
	const fire = fireDueSchedules({
		...ports,
		log,
		usage: { note: (moment) => usage.push(moment) },
		watch: createScheduleWatch(ports.clock()),
	});
	return {
		usage,
		look: () => fire({ held: () => false, stopped: () => false }),
		fire,
	};
}

/** A project with `schedules`, a daemon that began at `startedAt`, and one look at that moment. */
async function watching(schedules: Schedule[], startedAt = at(16, 21, 59)) {
	const ports = await schedulePorts(startedAt);
	ports.projects.add({ id: P, spaceId: "space-1" });
	ports.store.seed(P, { schedules });
	const first = daemon(ports);
	await first.look();
	return { ports, ...first };
}

/** The fired and skipped facts, as the log has them. */
function facts(ports: Awaited<ReturnType<typeof schedulePorts>>) {
	return ports.facts();
}

describe("the scheduler's look", () => {
	test("starts a schedule once at its cron time, with the schedule as the trigger", async () => {
		const { ports, look, usage } = await watching([
			nightly({ inputs: { epic: "42" }, stopAt: "07:00" }),
		]);
		expect(await facts(ports)).toEqual([]);

		ports.clock.set(at(16, 22, 0, 20));
		await look();
		await look();
		expect(ports.runs.started).toHaveLength(1);
		expect(ports.runs.started[0]).toMatchObject({
			input: {
				projectId: P,
				flowName: "night",
				inputs: { epic: "42" },
				// The first 07:00 after the start.
				stopAt: at(17, 7),
			},
			trigger: { kind: "schedule", scheduleId: "nightly", at: at(16, 22) },
		});
		expect(await facts(ports)).toEqual([
			{
				kind: "fired",
				projectId: P,
				scheduleId: "nightly",
				at: at(16, 22),
				runId: "run-1",
				error: null,
			},
		]);
		expect(usage).toEqual([{ kind: "schedule-fired" }]);
	});

	test("a schedule with a time zone fires and stops on that clock, not this computer's", async () => {
		// 22:00 in Tokyo on the 16th is 13:00 UTC. 07:00 there the next day is 22:00 UTC.
		const { ports, look } = await watching(
			[nightly({ stopAt: "07:00", timeZone: "Asia/Tokyo" })],
			utc(2026, 9, 16, 12, 59),
		);
		ports.clock.set(utc(2026, 9, 16, 13, 0, 20));
		await look();
		expect(ports.runs.started[0]).toMatchObject({
			input: { stopAt: utc(2026, 9, 16, 22) },
			trigger: { at: utc(2026, 9, 16, 13) },
		});
	});

	test("a scheduled run is its schedule's Person's, when the schedule names one", async () => {
		const { ports, look } = await watching([
			nightly({ id: "mine" }),
			nightly({ id: "carols", person: "person-carol" }),
		]);
		ports.clock.set(at(16, 22, 0, 20));
		await look();
		const starterOf = (scheduleId: string) =>
			ports.runs.started.find(
				(start) =>
					start.trigger.kind === "schedule" &&
					start.trigger.scheduleId === scheduleId,
			)?.input.startedBy;
		expect(ports.runs.started).toHaveLength(2);
		expect(starterOf("mine")).toBeUndefined();
		expect(starterOf("carols")).toBe("person-carol");
	});

	test("never fires the same cron time twice across a restart", async () => {
		const { ports, look } = await watching([nightly()]);
		ports.clock.set(at(16, 22, 1));
		await look();
		expect(ports.runs.started).toHaveLength(1);

		ports.clock.set(at(16, 22, 5));
		await daemon(ports).look();
		expect(ports.runs.started).toHaveLength(1);
		expect(await facts(ports)).toHaveLength(1);
	});

	test("the run's own start counts as fired when the daemon died before the fired fact", async () => {
		const ports = await schedulePorts(at(16, 22, 3));
		ports.projects.add({ id: P, spaceId: "space-1" });
		ports.store.seed(P, { schedules: [nightly()] });
		// What the scheduler leaves when it dies between the start and its record.
		await ports.runStarted({
			projectId: P,
			scheduleId: "nightly",
			at: at(16, 22),
			runId: "cut-short",
		});
		await daemon(ports).look();
		expect(ports.runs.started).toEqual([]);
		expect(await facts(ports)).toHaveLength(1);
	});

	test("a time missed by less than 15 minutes fires after a restart", async () => {
		const { ports } = await watching([nightly()], at(16, 22, 14));
		expect(ports.runs.started).toHaveLength(1);
		expect(await facts(ports)).toMatchObject([
			{ kind: "fired", at: at(16, 22), error: null },
		]);
	});

	test("a time missed by more than 15 minutes is skipped, with the reason", async () => {
		const { ports, look } = await watching([nightly()]);
		ports.clock.set(at(16, 22));
		await look();

		// Down all day. Back the next evening, 30 minutes after the time.
		ports.clock.set(at(17, 22, 30));
		const second = daemon(ports);
		await second.look();
		await second.look();
		expect(await facts(ports)).toHaveLength(2);
		expect((await facts(ports))[1]).toEqual({
			kind: "skipped",
			projectId: P,
			scheduleId: "nightly",
			at: at(17, 22),
			reason:
				"Missed by 30 min. Night Shift was off, or the computer was asleep. This schedule starts at most 15 min late.",
			runId: null,
		});
		expect(ports.runs.started).toHaveLength(1);
		expect(second.usage).toEqual([
			{
				kind: "schedule-skipped",
				reason:
					"Missed by 30 min. Night Shift was off, or the computer was asleep. This schedule starts at most 15 min late.",
			},
		]);
	});

	test("a time the daemon watched come due but slept through is skipped", async () => {
		const { ports, look } = await watching([nightly()]);
		// The computer slept from 21:59 to 23:00.
		ports.clock.set(at(16, 23));
		await look();
		expect(await facts(ports)).toMatchObject([
			{
				kind: "skipped",
				at: at(16, 22),
				reason: expect.stringContaining("Missed by 1 h."),
			},
		]);
		expect(ports.runs.started).toEqual([]);
	});

	test("a schedule added after its time is not reported as missed", async () => {
		const { ports, look } = await watching([nightly()], at(16, 23));
		await look();
		expect(await facts(ports)).toEqual([]);
		expect(ports.notices.misses).toEqual([]);
	});

	test("a missed time starts once within its lateMinutes, with the time it was due", async () => {
		const { ports, look } = await watching([nightly({ lateMinutes: 1440 })]);
		ports.clock.set(at(16, 22));
		await look();
		ports.runs.setStatus("run-1", "finished");

		// The Host is off from 21:30 to 23:30 the next evening, over 22:00.
		ports.clock.set(at(17, 23, 30));
		await daemon(ports).look();
		expect(ports.runs.started).toHaveLength(2);
		expect(ports.runs.started[1]?.trigger).toEqual({
			kind: "schedule",
			scheduleId: "nightly",
			at: at(17, 22),
		});
		expect((await facts(ports))[1]).toMatchObject({
			kind: "fired",
			at: at(17, 22),
			error: null,
		});

		// Started again: the time does not start a second run.
		ports.clock.set(at(17, 23, 45));
		await daemon(ports).look();
		expect(ports.runs.started).toHaveLength(2);
		expect(await facts(ports)).toHaveLength(2);
	});

	test("a missed time past its lateMinutes is skipped, and the Space hears of it", async () => {
		const { ports, look } = await watching([nightly({ lateMinutes: 60 })]);
		ports.clock.set(at(16, 22));
		await look();

		ports.clock.set(at(17, 23, 30));
		await daemon(ports).look();
		expect((await facts(ports))[1]).toMatchObject({
			kind: "skipped",
			at: at(17, 22),
			reason:
				"Missed by 1 h 30 min. Night Shift was off, or the computer was asleep. This schedule starts at most 1 h late.",
		});
		expect(ports.notices.misses).toEqual([
			{ projectId: P, scheduleId: "nightly", flow: "night", at: at(17, 22) },
		]);
		expect(ports.runs.started).toHaveLength(1);
	});

	test("telling of a miss that fails does not stop the look", async () => {
		const { ports, look } = await watching([
			nightly({ id: "first" }),
			nightly({ id: "second" }),
		]);
		ports.notices.failMissed(new Error("nobody listens"));
		ports.clock.set(at(16, 23));
		const logged = spyOn(console, "error").mockImplementation(() => {});
		try {
			await look();
			expect(logged.mock.calls.map((call) => call[0])).toEqual([
				"[schedules] first: telling of a miss failed",
				"[schedules] second: telling of a miss failed",
			]);
		} finally {
			logged.mockRestore();
		}
		expect(
			(await facts(ports)).map((fact) => [fact.kind, fact.scheduleId]),
		).toEqual([
			["skipped", "first"],
			["skipped", "second"],
		]);
	});

	test("a pause or an open run is skipped without telling of a miss", async () => {
		const { ports, look, usage } = await watching([
			nightly({ lateMinutes: 1440, pausedUntil: at(17, 6) }),
		]);
		ports.clock.set(at(16, 22, 1));
		await look();
		expect(await facts(ports)).toEqual([
			{
				kind: "skipped",
				projectId: P,
				scheduleId: "nightly",
				at: at(16, 22),
				reason: "You paused this schedule for tonight.",
				runId: null,
			},
		]);
		expect(ports.notices.misses).toEqual([]);
		expect(ports.runs.started).toEqual([]);
		expect(usage).toEqual([
			{
				kind: "schedule-skipped",
				reason: "You paused this schedule for tonight.",
			},
		]);
	});

	test("lateMinutes does not start a time from before the schedule existed", async () => {
		const { ports, look } = await watching(
			[nightly({ lateMinutes: 1440 })],
			at(16, 23),
		);
		await look();
		expect(await facts(ports)).toEqual([]);
		expect(ports.runs.started).toEqual([]);
	});

	test("does not start while an earlier run of the schedule is still open", async () => {
		const { ports, look } = await watching([nightly({ cron: "0 * * * *" })]);
		ports.clock.set(at(16, 22));
		await look();
		ports.runs.setStatus("run-1", "waiting");

		ports.clock.set(at(16, 23, 0, 30));
		await look();
		expect((await facts(ports))[1]).toEqual({
			kind: "skipped",
			projectId: P,
			scheduleId: "nightly",
			at: at(16, 23),
			reason: "An earlier run of this schedule is still waiting.",
			runId: "run-1",
		});
		expect(ports.runs.started).toHaveLength(1);
		expect(ports.notices.misses).toEqual([]);

		// Once the run ends, the next time fires again.
		ports.runs.setStatus("run-1", "stopped");
		ports.clock.set(at(17, 0, 0, 30));
		await look();
		expect((await facts(ports))[2]).toMatchObject({
			kind: "fired",
			at: at(17, 0),
			error: null,
		});
		expect(ports.runs.started).toHaveLength(2);
	});

	test("a schedule that is off, has no flow or starts on a webhook does not fire", async () => {
		const { ports, look } = await watching([
			nightly({ id: "off", enabled: false }),
			{ id: "no-flow", inputs: {}, cron: "0 22 * * *", enabled: true },
			nightly({ id: "hook", webhook: { secret: HOOK_SECRET } }),
		]);
		ports.clock.set(at(16, 22, 1));
		await look();
		expect(await facts(ports)).toEqual([]);
		expect(ports.runs.started).toEqual([]);
	});

	test("a schedule of a Space that another Device keeps does not fire here", async () => {
		const ports = await schedulePorts(at(16, 21, 59));
		ports.projects.add({ id: P, spaceId: "space-1", firesHere: false });
		ports.store.seed(P, { schedules: [nightly()] });
		const { look } = daemon(ports);
		await look();
		ports.clock.set(at(16, 22, 1));
		await look();
		expect(await facts(ports)).toEqual([]);
		expect(ports.runs.started).toEqual([]);

		// It is not watched there: when this Device takes the Space over, the old time is not missed.
		ports.projects.add({ id: P, spaceId: "space-1" });
		ports.clock.set(at(16, 23));
		await look();
		expect(await facts(ports)).toEqual([]);
	});

	test("picks up an edit of the schedules on the next look, without a restart", async () => {
		const { ports, look } = await watching([nightly({ cron: "0 23 * * *" })]);
		await ports.store.save(P, [nightly()]);
		ports.clock.set(at(16, 22, 0, 10));
		await look();
		expect(await facts(ports)).toMatchObject([
			{ kind: "fired", at: at(16, 22), error: null },
		]);
	});

	test("a start that is refused is recorded with its words, once", async () => {
		const { ports, look, usage } = await watching([nightly({ flow: "gone" })]);
		ports.runs.failNextStart(
			new Refusal("not-found", 'The flow "gone" does not exist.'),
		);
		ports.clock.set(at(16, 22, 1));
		const logged = spyOn(console, "error").mockImplementation(() => {});
		try {
			await look();
			await look();
			// A refusal is for the person, not for the log of the daemon.
			expect(logged).not.toHaveBeenCalled();
		} finally {
			logged.mockRestore();
		}
		expect(await facts(ports)).toEqual([
			{
				kind: "fired",
				projectId: P,
				scheduleId: "nightly",
				at: at(16, 22),
				runId: null,
				error: 'The flow "gone" does not exist.',
			},
		]);
		// Only a run counts as fired for the usage numbers.
		expect(usage).toEqual([]);
	});

	test("a start that fails for another reason is recorded with words for people", async () => {
		const { ports, look } = await watching([nightly()]);
		ports.runs.failNextStart(new Error("the disk is full"));
		ports.clock.set(at(16, 22, 1));
		// A failure that is no refusal goes to the log of the daemon.
		const logged = spyOn(console, "error").mockImplementation(() => {});
		try {
			await look();
			expect(logged.mock.calls.map((call) => call[0])).toEqual([
				"[schedules] nightly did not start a run",
			]);
		} finally {
			logged.mockRestore();
		}
		expect(await facts(ports)).toMatchObject([
			{
				kind: "fired",
				runId: null,
				error:
					"Something went wrong. Night Shift saved the details. Try again.",
			},
		]);
	});

	test("a removed project's schedules do not fire", async () => {
		const { ports, look } = await watching([nightly()]);
		ports.projects.remove(P);
		ports.clock.set(at(16, 22, 1));
		await look();
		expect(await facts(ports)).toEqual([]);
	});

	test("a project whose schedules do not load is passed over", async () => {
		const { ports, look } = await watching([nightly()]);
		// A project the store cannot read, before the one it can.
		ports.projects.remove(P);
		ports.projects.add({ id: "unreadable", spaceId: "space-1" });
		ports.projects.add({ id: P, spaceId: "space-1" });
		ports.clock.set(at(16, 22, 1));
		await look();
		expect(await facts(ports)).toMatchObject([{ kind: "fired", projectId: P }]);
	});

	test("the first of two schedules with one id counts", async () => {
		const { ports, look } = await watching([
			nightly({ inputs: { epic: "first" } }),
			nightly({ inputs: { epic: "second" } }),
		]);
		ports.clock.set(at(16, 22, 1));
		await look();
		expect(ports.runs.started.map((start) => start.input.inputs)).toEqual([
			{ epic: "first" },
		]);
	});
});

describe("the settings' scheduler switch", () => {
	test("off skips every look: nothing fires", async () => {
		const ports = await schedulePorts(at(16, 21, 59));
		ports.projects.add({ id: P, spaceId: "space-1" });
		ports.store.seed(P, { schedules: [nightly()] });
		ports.switch.turn(false);
		const { look } = daemon(ports);
		await look();
		ports.clock.set(at(16, 22, 0, 20));
		await look();
		expect(await facts(ports)).toEqual([]);
		expect(ports.runs.started).toEqual([]);
	});

	test("turned on again, it neither fires nor reports a time that came due while off", async () => {
		const { ports, look } = await watching([nightly()]);
		// Watching from 21:59, then off before the time.
		ports.switch.turn(false);
		await look();
		ports.clock.set(at(16, 22, 30));
		await look();
		ports.switch.turn(true);
		await look();
		expect(await facts(ports)).toEqual([]);
		expect(ports.runs.started).toEqual([]);

		// Later that evening it is not missed either.
		ports.clock.set(at(16, 23, 30));
		await look();
		expect(await facts(ports)).toEqual([]);

		// The next time fires as usual.
		ports.clock.set(at(17, 22, 0, 10));
		await look();
		expect(await facts(ports)).toMatchObject([
			{ kind: "fired", at: at(17, 22), error: null },
		]);
	});

	test("turned on within the grace of a time that came due while off, it does not fire it", async () => {
		const ports = await schedulePorts(at(16, 21, 59));
		ports.projects.add({ id: P, spaceId: "space-1" });
		ports.store.seed(P, { schedules: [nightly()] });
		ports.switch.turn(false);
		const { look } = daemon(ports);
		await look();
		ports.clock.set(at(16, 22, 5));
		await look();
		ports.switch.turn(true);
		await look();
		expect(await facts(ports)).toEqual([]);
		expect(ports.runs.started).toEqual([]);

		ports.clock.set(at(17, 22, 0, 10));
		await look();
		expect(await facts(ports)).toMatchObject([
			{ kind: "fired", at: at(17, 22), error: null },
		]);
	});

	test("the look does not ask whether the engine started its scheduler: only the ticker knows", async () => {
		const { ports, look } = await watching([nightly()]);
		ports.switch.start(false);
		ports.clock.set(at(16, 22, 1));
		await look();
		expect(ports.runs.started).toHaveLength(1);
	});
});

describe("Pause tonight, at the cron time", () => {
	test("skips tonight's start with the reason, across a restart, then fires the next evening", async () => {
		const { ports } = await watching(
			[nightly({ pausedUntil: at(17, 6) })],
			at(16, 12),
		);
		// The pause is in the schedule: a restart keeps it.
		const second = daemon(ports);
		ports.clock.set(at(16, 22, 0, 20));
		await second.look();
		expect(await facts(ports)).toEqual([
			{
				kind: "skipped",
				projectId: P,
				scheduleId: "nightly",
				at: at(16, 22),
				reason: "You paused this schedule for tonight.",
				runId: null,
			},
		]);
		expect(ports.runs.started).toEqual([]);

		ports.clock.set(at(17, 22, 0, 20));
		await second.look();
		expect((await facts(ports))[1]).toMatchObject({
			kind: "fired",
			at: at(17, 22),
			error: null,
		});
	});

	test("an hourly schedule skips the night and fires again at 06:00", async () => {
		const { ports, look } = await watching(
			[nightly({ cron: "0 * * * *", pausedUntil: at(17, 6) })],
			at(16, 23, 30),
		);
		ports.clock.set(at(17, 5, 0, 20));
		await look();
		expect(await facts(ports)).toMatchObject([
			{ kind: "skipped", at: at(17, 5) },
		]);
		ports.clock.set(at(17, 6, 0, 20));
		await look();
		expect((await facts(ports))[1]).toMatchObject({
			kind: "fired",
			at: at(17, 6),
		});
	});
});

describe("a hold and a stop", () => {
	test("a held look lists no project and starts nothing", async () => {
		const { ports, fire } = await watching([nightly()]);
		let listed = 0;
		const all = ports.projects.all;
		ports.projects.all = async () => {
			listed++;
			return all();
		};
		const held = fireDueSchedules({
			...ports,
			watch: createScheduleWatch(ports.clock()),
		});
		ports.clock.set(at(16, 22, 0, 20));
		await held({ held: () => true, stopped: () => false });
		expect(listed).toBe(0);
		expect(ports.runs.started).toEqual([]);

		// After the release the time fires, within its grace.
		ports.clock.set(at(16, 22, 2));
		await fire({ held: () => false, stopped: () => false });
		expect(await facts(ports)).toMatchObject([
			{ kind: "fired", at: at(16, 22), error: null },
		]);
	});

	test("a held look still reads the facts of the log", async () => {
		const { ports } = await watching([nightly()]);
		let read = 0;
		const histories = ports.log.histories;
		ports.log.histories = async () => {
			read++;
			return histories();
		};
		const held = fireDueSchedules({
			...ports,
			watch: createScheduleWatch(ports.clock()),
		});
		await held({ held: () => true, stopped: () => false });
		expect(read).toBe(1);
	});

	test("a hold that comes during a look ends it before the next schedule", async () => {
		const { ports, fire } = await watching([
			nightly({ id: "first" }),
			nightly({ id: "second" }),
		]);
		ports.clock.set(at(16, 22, 0, 20));
		// The hold comes when the first run has started.
		await fire({
			held: () => ports.runs.started.length > 0,
			stopped: () => false,
		});
		expect(
			ports.runs.started.map((start) =>
				start.trigger.kind === "schedule" ? start.trigger.scheduleId : null,
			),
		).toEqual(["first"]);
		// The run that started is in the log before the hold counts.
		expect(await facts(ports)).toMatchObject([
			{ kind: "fired", scheduleId: "first" },
		]);
	});

	test("a stop ends the look before the next project", async () => {
		const { ports, fire } = await watching([nightly()]);
		ports.clock.set(at(16, 22, 0, 20));
		await fire({ held: () => false, stopped: () => true });
		expect(ports.runs.started).toEqual([]);
	});
});
