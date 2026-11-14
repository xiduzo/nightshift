import { describe, expect, test } from "bun:test";

import { parseInstant } from "./clock";
import { moonPhase } from "./moon";

describe("the logo shows the phase of the moon", () => {
	test.each([
		["2024-01-11T11:57:00Z", 0],
		["2024-01-14T20:00:00Z", 1],
		["2024-01-18T03:53:00Z", 2],
		["2024-01-25T17:54:00Z", 4],
		["2024-02-02T23:18:00Z", 6],
		["2024-04-23T23:49:00Z", 4],
		["2026-11-24T14:53:00Z", 4],
	] as const)("at %s the phase is %d", (at, phase) => {
		expect(moonPhase(parseInstant(at))).toBe(phase);
	});
});
