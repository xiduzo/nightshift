import { describe, expect, test } from "bun:test";
import type { Schedule } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import { atLocal, utc } from "@nightshift/time/testing";
import {
	pausedAt,
	pausedTonight,
	pauseTonightEnds,
	withoutEndedPause,
	withoutPause,
} from "./pause-tonight";

/** Local time on the computer's clock, October 2026. */
function at(day: number, hours: number, minutes = 0): number {
	return atLocal(2026, 9, day, hours, minutes);
}

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

/** What `pausedTonight` refuses with. */
function refusal(schedule: Schedule, nextStart: number | null): unknown {
	try {
		pausedTonight(schedule, nextStart);
	} catch (error) {
		return error;
	}
	return null;
}

describe("Pause tonight", () => {
	test("lasts until the first 06:00 after the next start, on the schedule's clock", () => {
		expect(pauseTonightEnds(at(16, 22))).toBe(at(17, 6));
		// A start in the day pauses until the next morning too.
		expect(pauseTonightEnds(at(16, 9))).toBe(at(17, 6));
		// 22:00 in Tokyo is 13:00 UTC. 06:00 there the next day is 21:00 UTC.
		expect(pauseTonightEnds(utc(2026, 9, 16, 13), "Asia/Tokyo")).toBe(
			utc(2026, 9, 16, 21),
		);
	});

	test("pauses the schedule until that morning", () => {
		expect(pausedTonight(nightly(), at(16, 22))).toEqual(
			nightly({ pausedUntil: at(17, 6) }),
		);
	});

	test("refuses a schedule that is off, has a webhook, or has no next start", () => {
		const off = refusal(nightly({ enabled: false }), null);
		expect(off).toBeInstanceOf(Refusal);
		expect(off).toMatchObject({
			kind: "invalid",
			message: "This schedule is off. It starts nothing tonight.",
		});
		expect(
			refusal(
				// biome-ignore lint/suspicious/noTemplateCurlyInString: a secret reference, as a person writes it.
				nightly({ webhook: { secret: "${HOOK_SECRET}" } }),
				null,
			),
		).toMatchObject({
			kind: "invalid",
			message: "This schedule starts on a webhook. It has no times to pause.",
		});
		expect(refusal(nightly(), null)).toMatchObject({
			kind: "invalid",
			message: "This schedule has no next start to pause.",
		});
	});

	test("a schedule is paused until its pause ends", () => {
		const paused = nightly({ pausedUntil: at(17, 6) });
		expect(pausedAt(paused, at(16, 12))).toBe(true);
		expect(pausedAt(paused, at(17, 6))).toBe(false);
		expect(pausedAt(nightly(), at(16, 12))).toBe(false);
	});

	test("a pause that has ended is dropped, one that lasts stays", () => {
		const paused = nightly({ pausedUntil: at(17, 6) });
		expect(withoutEndedPause(paused, at(16, 12))).toBe(paused);
		expect(withoutEndedPause(paused, at(17, 9))).toEqual(nightly());
		expect(withoutEndedPause(nightly(), at(17, 9))).toEqual(nightly());
	});

	test("resume drops the pause, and a schedule without one stays as it is", () => {
		expect(withoutPause(nightly({ pausedUntil: at(17, 6) }))).toEqual(
			nightly(),
		);
		expect(withoutPause(nightly())).toEqual(nightly());
	});
});
