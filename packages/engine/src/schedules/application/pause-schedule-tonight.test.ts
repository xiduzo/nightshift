import { describe, expect, test } from "bun:test";
import type { Schedule } from "@nightshift/flows";
import { atLocal } from "@nightshift/time/testing";
import { inMemorySchedulePorts } from "../adapters/out/in-memory-neighbours";
import { createScheduleWatch } from "../domain/schedule-watch";
import { pauseScheduleTonight } from "./pause-schedule-tonight";

/** Pause tonight, on in-memory adapters. */

/** Local time on the computer's clock, October 2026 (the 16th is a Friday). */
function at(day: number, hours: number, minutes = 0, seconds = 0): number {
	return atLocal(2026, 9, day, hours, minutes, seconds);
}

const P = "project-1";
const SPACE = "space-1";
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

/** A project in a Space with `schedules`, at `now`. */
function project(schedules: Schedule[], now = at(16, 12)) {
	const ports = inMemorySchedulePorts(now);
	ports.projects.add({ id: P, spaceId: SPACE });
	ports.store.seed(P, { schedules });
	const pause = pauseScheduleTonight({
		...ports,
		watch: createScheduleWatch(now),
	});
	return {
		ports,
		pause: (scheduleId: string, spaceId = SPACE) =>
			pause(undefined, { spaceId, projectId: P, scheduleId }),
		saved: async () =>
			(await ports.store.list(P, { validate: false })).schedules,
	};
}

/** What a request refuses with, or null. */
const refusalOf = (work: Promise<unknown>) =>
	work.then(
		() => null,
		(error: unknown) => error,
	);

describe("Pause tonight", () => {
	test("pauses until the first 06:00 after the next start, and says when the schedule starts again", async () => {
		const morning = nightly({ id: "morning", cron: "0 7 * * *" });
		const { pause, saved } = project([morning, nightly()]);
		expect(await pause("nightly")).toEqual({
			pausedUntil: at(17, 6),
			nextAt: at(17, 22),
		});
		// The pause is in the schedule. The other schedules and the order stay.
		expect(await saved()).toEqual([
			morning,
			nightly({ pausedUntil: at(17, 6) }),
		]);
	});

	test("an hourly schedule skips the night and starts again at 06:00", async () => {
		const { pause } = project([nightly({ cron: "0 * * * *" })], at(16, 23, 30));
		expect(await pause("nightly")).toEqual({
			pausedUntil: at(17, 6),
			nextAt: at(17, 6),
		});
	});

	test("a second pause counts from the next start without the first", async () => {
		const { pause, saved } = project([nightly({ pausedUntil: at(17, 6) })]);
		expect(await pause("nightly")).toEqual({
			pausedUntil: at(17, 6),
			nextAt: at(17, 22),
		});
		expect(await saved()).toEqual([nightly({ pausedUntil: at(17, 6) })]);
	});

	test("a time the log has handled is not the next start: the pause is for the evening after", async () => {
		const { ports, pause } = project([nightly()], at(16, 22, 5));
		await ports.log.fired({
			projectId: P,
			scheduleId: "nightly",
			at: at(16, 22),
			runId: "run-1",
			error: null,
		});
		expect(await pause("nightly")).toEqual({
			pausedUntil: at(18, 6),
			nextAt: at(18, 22),
		});
	});

	test("refuses a schedule that is off, has a webhook or does not exist, and saves nothing", async () => {
		const schedules = [
			nightly({ id: "off", enabled: false }),
			nightly({
				id: "hook",
				cron: undefined,
				webhook: { secret: HOOK_SECRET },
			}),
		];
		const { pause, saved } = project(schedules);
		expect(await refusalOf(pause("off"))).toMatchObject({
			kind: "invalid",
			message: "This schedule is off. It starts nothing tonight.",
		});
		expect(await refusalOf(pause("hook"))).toMatchObject({
			kind: "invalid",
			message: "This schedule starts on a webhook. It has no times to pause.",
		});
		expect(await refusalOf(pause("gone"))).toMatchObject({
			kind: "not-found",
			message: "This schedule does not exist. Someone may have removed it.",
		});
		expect(await saved()).toEqual(schedules);
	});

	test("tells the open screens of the Space after the save, and waits for it", async () => {
		const { ports, pause } = project([nightly()]);
		// The screens hear of it when the pause is saved.
		let savedWhenTold: number | undefined;
		const changed = ports.notices.changed;
		ports.notices.changed = async (spaceId, projectId) => {
			savedWhenTold = (await ports.store.list(P, { validate: false }))
				.schedules[0]?.pausedUntil;
			await changed(spaceId, projectId);
		};
		await pause("nightly");
		expect(ports.notices.changes).toEqual([{ spaceId: SPACE, projectId: P }]);
		expect(savedWhenTold).toBe(at(17, 6));
	});

	test("a refused pause tells nobody", async () => {
		const { ports, pause } = project([nightly({ enabled: false })]);
		await refusalOf(pause("nightly"));
		await refusalOf(pause("gone"));
		await refusalOf(pause("nightly", "space-2"));
		expect(ports.notices.changes).toEqual([]);
	});

	test("when the screens cannot be told, the request fails, and the pause stays saved", async () => {
		const { ports, pause, saved } = project([nightly()]);
		const failure = new Error("the stream is gone");
		ports.notices.failChanged(failure);
		expect(await refusalOf(pause("nightly"))).toBe(failure);
		expect(await saved()).toEqual([nightly({ pausedUntil: at(17, 6) })]);
	});

	test("a project of another Space is not found", async () => {
		const { pause, saved } = project([nightly()]);
		expect(await refusalOf(pause("nightly", "space-2"))).toMatchObject({
			kind: "not-found",
		});
		expect(await saved()).toEqual([nightly()]);
	});
});
