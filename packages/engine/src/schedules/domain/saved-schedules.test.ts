import { describe, expect, test } from "bun:test";
import type { Schedule } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";

import {
	SCHEDULE_NOT_FOUND,
	scheduleOf,
	withSchedule,
	withTimeZone,
} from "./saved-schedules";

const base = { inputs: {}, enabled: true } as const;

describe("withTimeZone", () => {
	test("gives the saver's clock to each schedule with a time and none of its own", () => {
		const schedules: Schedule[] = [
			{ ...base, id: "night", flow: "night", cron: "0 22 * * *" },
			{
				...base,
				id: "tokyo",
				flow: "night",
				cron: "0 22 * * *",
				timeZone: "Asia/Tokyo",
			},
			{
				...base,
				id: "hook",
				flow: "night",
				// biome-ignore lint/suspicious/noTemplateCurlyInString: a secret reference, as a person writes it.
				webhook: { secret: "${HOOK_SECRET}" },
			},
			{
				...base,
				id: "hook-stops",
				flow: "night",
				// biome-ignore lint/suspicious/noTemplateCurlyInString: a secret reference, as a person writes it.
				webhook: { secret: "${HOOK_SECRET}" },
				stopAt: "07:00",
			},
		];
		expect(
			withTimeZone(schedules, "Europe/Amsterdam").map((s) => [
				s.id,
				s.timeZone,
			]),
		).toEqual([
			["night", "Europe/Amsterdam"],
			["tokyo", "Asia/Tokyo"],
			["hook", undefined],
			["hook-stops", "Europe/Amsterdam"],
		]);
	});
});

describe("one schedule of a project", () => {
	const night: Schedule = {
		...base,
		id: "night",
		flow: "night",
		cron: "0 22 * * *",
	};
	const again: Schedule = { ...night, flow: "second" };
	const morning: Schedule = { ...night, id: "morning", cron: "0 7 * * *" };

	test("is the first with its id", () => {
		expect(scheduleOf([night, again, morning], "night")).toBe(night);
		expect(scheduleOf([night, again, morning], "morning")).toBe(morning);
	});

	test("an id that no schedule has is not found", () => {
		let refused: unknown;
		try {
			scheduleOf([night], "gone");
		} catch (error) {
			refused = error;
		}
		expect(refused).toBeInstanceOf(Refusal);
		expect(refused).toMatchObject({
			kind: "not-found",
			message: "This schedule does not exist. Someone may have removed it.",
		});
		expect(SCHEDULE_NOT_FOUND).toBe(
			"This schedule does not exist. Someone may have removed it.",
		);
	});

	test("a changed schedule takes the place of the one with its id, in the same order", () => {
		const paused = { ...morning, pausedUntil: 100 };
		expect(withSchedule([night, morning], paused)).toEqual([night, paused]);
	});
});
