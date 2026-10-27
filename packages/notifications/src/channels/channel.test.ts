import { describe, expect, test } from "bun:test";

import { deviceWaitWords } from "./channel";

/** 22:00 in Amsterdam (20:00 UTC). */
const NIGHT = Date.UTC(2026, 9, 27, 21, 0);

describe("the words of a device wait", () => {
	test("name the flow, the device, and the stop time in the person's time zone", () => {
		expect(
			deviceWaitWords({
				flow: "Nightly triage",
				device: "studio-mac",
				stopAt: Date.UTC(2026, 9, 28, 5, 0),
				timeZone: "Europe/Amsterdam",
				now: NIGHT,
			}),
		).toEqual({
			title: "Nightly triage waits for studio-mac",
			body: "The step starts when the device is back. If it is not back by 06:00, the run stops.",
		});
	});

	test("a stop time more than a day away names its day", () => {
		expect(
			deviceWaitWords({
				flow: "Triage",
				device: "studio-mac",
				stopAt: Date.UTC(2026, 9, 30, 5, 0),
				timeZone: "Europe/Amsterdam",
				now: NIGHT,
			}).body,
		).toBe(
			"The step starts when the device is back. If it is not back by Fri 30 Oct at 06:00, the run stops.",
		);
	});

	test("without a stop time, or one that passed, they say only what happens next", () => {
		for (const stopAt of [null, NIGHT - 1]) {
			expect(
				deviceWaitWords({
					flow: "Triage",
					device: null,
					stopAt,
					timeZone: "UTC",
					now: NIGHT,
				}),
			).toEqual({
				title: "Triage waits for a device",
				body: "The step starts when the device is back.",
			});
		}
	});
});
