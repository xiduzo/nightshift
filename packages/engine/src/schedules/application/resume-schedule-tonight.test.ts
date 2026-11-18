import { describe, expect, test } from "bun:test";
import type { Schedule } from "@nightshift/flows";
import { atLocal } from "@nightshift/time/testing";
import { inMemorySchedulePorts } from "../adapters/out/in-memory-neighbours";
import { createScheduleWatch } from "../domain/schedule-watch";
import { resumeScheduleTonight } from "./resume-schedule-tonight";

/** The end of a pause tonight, on in-memory adapters. */

/** Local time on the computer's clock, October 2026 (the 16th is a Friday). */
function at(day: number, hours: number, minutes = 0, seconds = 0): number {
	return atLocal(2026, 9, day, hours, minutes, seconds);
}

const P = "project-1";
const SPACE = "space-1";

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
	const resume = resumeScheduleTonight({
		...ports,
		watch: createScheduleWatch(now),
	});
	return {
		ports,
		resume: (scheduleId: string, spaceId = SPACE) =>
			resume(undefined, { spaceId, projectId: P, scheduleId }),
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

describe("Resume tonight", () => {
	test("ends the pause: tonight's start is next again", async () => {
		const morning = nightly({ id: "morning", cron: "0 7 * * *" });
		const { resume, saved } = project([
			morning,
			nightly({ pausedUntil: at(17, 6) }),
		]);
		expect(await resume("nightly")).toEqual({
			pausedUntil: null,
			nextAt: at(16, 22),
		});
		expect(await saved()).toEqual([morning, nightly()]);
	});

	test("a schedule without a pause stays as it is", async () => {
		const { resume, saved } = project([nightly()]);
		expect(await resume("nightly")).toEqual({
			pausedUntil: null,
			nextAt: at(16, 22),
		});
		expect(await saved()).toEqual([nightly()]);
	});

	test("says the next start as it is after the save", async () => {
		const { ports, resume } = project(
			[nightly({ pausedUntil: at(17, 6) })],
			at(16, 21, 59),
		);
		// The save takes until after tonight's time, and too long for it to start.
		const save = ports.store.save;
		ports.store.save = async (projectId, schedules) => {
			const issues = await save(projectId, schedules);
			ports.clock.set(at(16, 23));
			return issues;
		};
		expect(await resume("nightly")).toEqual({
			pausedUntil: null,
			nextAt: at(17, 22),
		});
	});

	test("tells the open screens of the Space after the save, and waits for it", async () => {
		const { ports, resume } = project([nightly({ pausedUntil: at(17, 6) })]);
		let pausedWhenTold: number | undefined = 0;
		const changed = ports.notices.changed;
		ports.notices.changed = async (spaceId, projectId) => {
			pausedWhenTold = (await ports.store.list(P, { validate: false }))
				.schedules[0]?.pausedUntil;
			await changed(spaceId, projectId);
		};
		await resume("nightly");
		expect(ports.notices.changes).toEqual([{ spaceId: SPACE, projectId: P }]);
		expect(pausedWhenTold).toBeUndefined();
	});

	test("when the screens cannot be told, the request fails, and the pause stays ended", async () => {
		const { ports, resume, saved } = project([
			nightly({ pausedUntil: at(17, 6) }),
		]);
		const failure = new Error("the stream is gone");
		ports.notices.failChanged(failure);
		expect(await refusalOf(resume("nightly"))).toBe(failure);
		expect(await saved()).toEqual([nightly()]);
	});

	test("a schedule that does not exist, or a project of another Space, is not found", async () => {
		const { ports, resume, saved } = project([
			nightly({ pausedUntil: at(17, 6) }),
		]);
		expect(await refusalOf(resume("gone"))).toMatchObject({
			kind: "not-found",
			message: "This schedule does not exist. Someone may have removed it.",
		});
		expect(await refusalOf(resume("nightly", "space-2"))).toMatchObject({
			kind: "not-found",
		});
		expect(await saved()).toEqual([nightly({ pausedUntil: at(17, 6) })]);
		expect(ports.notices.changes).toEqual([]);
	});
});
