import { describe, expect, test } from "bun:test";
import { atLocal, utc } from "@nightshift/time/testing";
import { inMemoryClock } from "../adapters/out/in-memory-neighbours";
import { previewCron } from "./preview-cron";

/** How a cron line reads, on a clock the test sets. */

/** Local time on the computer's clock, October 2026 (the 16th is a Friday). */
function at(day: number, hours: number, minutes = 0): number {
	return atLocal(2026, 9, day, hours, minutes);
}

describe("the preview of a cron line", () => {
	test("says how the line reads, and gives its next three times from now", async () => {
		const preview = previewCron({ clock: inMemoryClock(at(16, 12)) });
		expect(await preview({ cron: "0 22 * * 1-5" })).toEqual({
			error: null,
			description: "weekdays at 22:00",
			// Friday, then Monday and Tuesday.
			times: [at(16, 22), at(19, 22), at(20, 22)],
		});
	});

	test("gives as many times as asked", async () => {
		const preview = previewCron({ clock: inMemoryClock(at(16, 12)) });
		const { times } = await preview({
			cron: "0 22 * * *",
			count: 5,
		});
		expect(times).toEqual([
			at(16, 22),
			at(17, 22),
			at(18, 22),
			at(19, 22),
			at(20, 22),
		]);
	});

	test("reads the times on the clock it is given, not this computer's", async () => {
		const preview = previewCron({
			clock: inMemoryClock(utc(2026, 9, 16, 12)),
		});
		const { times } = await preview({
			cron: "0 22 * * *",
			count: 1,
			timeZone: "Asia/Tokyo",
		});
		// 22:00 in Tokyo is 13:00 UTC.
		expect(times).toEqual([utc(2026, 9, 16, 13)]);
	});

	test("counts from the clock: a time that passed is not next", async () => {
		const clock = inMemoryClock(at(16, 21, 59));
		const preview = previewCron({ clock });
		const first = await preview({ cron: "0 22 * * *", count: 1 });
		expect(first.times).toEqual([at(16, 22)]);
		clock.set(at(16, 22));
		const second = await preview({ cron: "0 22 * * *", count: 1 });
		expect(second.times).toEqual([at(17, 22)]);
	});

	test("a line that is not valid comes back with the reason, and no times", async () => {
		const preview = previewCron({ clock: inMemoryClock(at(16, 12)) });
		const read = await preview({ cron: "every night" });
		expect(read.error).toEqual(expect.any(String));
		expect(read.error).not.toBe("");
		expect(read.description).toBeNull();
		expect(read.times).toEqual([]);
	});
});
