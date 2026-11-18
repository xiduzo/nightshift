import { describe, expect, test } from "bun:test";
import type { Schedule } from "@nightshift/flows";
import { utc } from "@nightshift/time/testing";
import { scheduledStart } from "./scheduled-start";

/**
 * What a schedule starts, as the scheduler's tick, Run now and a webhook
 * start it: the same run, apart from a webhook's inputs and Run now's
 * starter.
 */

const nightly = (extra: Partial<Schedule> = {}): Schedule => ({
	id: "nightly",
	flow: "night",
	cron: "0 22 * * *",
	inputs: { epic: "42" },
	enabled: true,
	...extra,
});

describe("what a schedule starts", () => {
	test("its flow, inputs and base ref, the first stop time after the start on its clock, and its Person", () => {
		// 22:00 in Tokyo is 13:00 UTC; 07:00 there the next day is 22:00 UTC.
		const at = utc(2026, 9, 16, 13);
		expect(
			scheduledStart(
				"project-1",
				nightly({
					stopAt: "07:00",
					timeZone: "Asia/Tokyo",
					baseRef: "main",
					person: "person-carol",
				}),
				"night",
				at,
			),
		).toEqual({
			projectId: "project-1",
			flowName: "night",
			inputs: { epic: "42" },
			baseRef: "main",
			stopAt: utc(2026, 9, 16, 22),
			startedBy: "person-carol",
		});
	});

	test("without a stop time, a base ref or a Person, the run has none of them", () => {
		expect(
			scheduledStart("project-1", nightly(), "night", utc(2026, 9, 16, 13)),
		).toEqual({
			projectId: "project-1",
			flowName: "night",
			inputs: { epic: "42" },
		});
	});

	test("Run now: the person who clicked starts it, unless the schedule names its Person", () => {
		const at = utc(2026, 9, 16, 12);
		expect(
			scheduledStart("project-1", nightly(), "night", at, {
				startedBy: "person-ann",
			}).startedBy,
		).toBe("person-ann");
		expect(
			scheduledStart(
				"project-1",
				nightly({ person: "person-carol" }),
				"night",
				at,
				{ startedBy: "person-ann" },
			).startedBy,
		).toBe("person-carol");
	});

	test("a webhook: the inputs filled from its event, instead of the schedule's", () => {
		expect(
			scheduledStart("project-1", nightly(), "night", utc(2026, 9, 16, 12), {
				inputs: { epic: "7" },
			}).inputs,
		).toEqual({ epic: "7" });
	});
});
