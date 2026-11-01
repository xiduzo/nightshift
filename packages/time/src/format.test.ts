import { describe, expect, test } from "bun:test";

import { localZone, parseInstant, wall } from "./clock";
import { formatClock, formatRelative, formatUtc, hoverTime } from "./format";

const at = parseInstant("2026-11-01T18:31:00.000Z");

describe("formatUtc", () => {
	test("writes the same instant on every computer", () => {
		expect(formatUtc(at)).toBe("1 Nov 2026, 18:31 UTC");
	});
});

describe("hoverTime", () => {
	test("names the UTC instant, another clock, and the Device", () => {
		const zone =
			localZone() === "Pacific/Kiritimati" ? "UTC" : "Pacific/Kiritimati";
		const shown = wall(at, zone);
		const time = `${String(shown.hour).padStart(2, "0")}:${String(shown.minute).padStart(2, "0")}`;
		expect(hoverTime(at, { zone, device: "studio" })).toBe(
			`1 Nov 2026, 18:31 UTC. ${time} in ${zone}. Runs on studio`,
		);
	});

	test("skips the viewer's zone, and a Device that is blank", () => {
		expect(hoverTime(at, { zone: localZone(), device: "  " })).toBe(
			"1 Nov 2026, 18:31 UTC",
		);
	});
});

describe("formatRelative", () => {
	test("says just now inside a minute", () => {
		expect(formatRelative(at - 20_000, at)).toBe("just now");
	});
});

describe("formatClock", () => {
	test("writes the time of day within a day, else the day too", () => {
		const zone = "UTC";
		expect(formatClock(at, at - 60_000, zone)).toBe("18:31");
		expect(formatClock(at + 2 * 24 * 60 * 60_000, at, zone)).toBe(
			"Tue 3 Nov at 18:31",
		);
	});
});
