import { describe, expect, test } from "bun:test";
import type { Schedule } from "@nightshift/flows";

import { withTimeZone } from "./schedule-files";

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
