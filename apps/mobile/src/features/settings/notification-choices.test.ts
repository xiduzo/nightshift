/// <reference types="bun" />
import { describe, expect, test } from "bun:test";

import {
	DIGEST_TIMES,
	digestOptions,
	digestPatch,
	digestValue,
	HOURS,
} from "./notification-choices";

const night = { start: "22:00", end: "07:00" };

describe("the morning digest", () => {
	test("offers the morning every half hour", () => {
		expect(DIGEST_TIMES).toEqual([
			"06:00",
			"06:30",
			"07:00",
			"07:30",
			"08:00",
			"08:30",
			"09:00",
		]);
		expect(HOURS).toHaveLength(24);
	});

	test("shows its time, the end of quiet hours, or off", () => {
		expect(
			digestValue({
				digest: { when: "time", time: "07:30" },
				quietHours: null,
			}),
		).toBe("07:30");
		expect(
			digestValue({
				digest: { when: "quiet-hours-end", time: "08:00" },
				quietHours: night,
			}),
		).toBe("quiet-hours-end");
		expect(
			digestValue({
				digest: { when: "off", time: "08:00" },
				quietHours: night,
			}),
		).toBe("off");
	});

	test("shows its own time when it follows quiet hours and there are none", () => {
		expect(
			digestValue({
				digest: { when: "quiet-hours-end", time: "08:00" },
				quietHours: null,
			}),
		).toBe("08:00");
	});

	test("offers the end of quiet hours only when you have them", () => {
		const withQuiet = digestOptions({
			digest: { when: "time", time: "07:00" },
			quietHours: night,
		});
		expect(withQuiet[0]).toEqual({
			value: "quiet-hours-end",
			label: "When quiet hours end",
		});
		expect(withQuiet.at(-1)).toEqual({ value: "off", label: "Off" });
		const without = digestOptions({
			digest: { when: "time", time: "07:00" },
			quietHours: null,
		});
		expect(without.map((option) => option.value)).toEqual([
			...DIGEST_TIMES,
			"off",
		]);
	});

	test("keeps a time chosen on the web in its place", () => {
		const options = digestOptions({
			digest: { when: "time", time: "10:15" },
			quietHours: null,
		});
		expect(options.map((option) => option.value)).toEqual([
			...DIGEST_TIMES,
			"10:15",
			"off",
		]);
		expect(
			digestOptions({
				digest: { when: "time", time: "05:00" },
				quietHours: null,
			})[0]?.value,
		).toBe("05:00");
	});

	test("each choice saves what it says", () => {
		expect(digestPatch("off")).toEqual({ digest: { when: "off" } });
		expect(digestPatch("quiet-hours-end")).toEqual({
			digest: { when: "quiet-hours-end" },
		});
		expect(digestPatch("06:30")).toEqual({
			digest: { when: "time", time: "06:30" },
		});
	});
});
