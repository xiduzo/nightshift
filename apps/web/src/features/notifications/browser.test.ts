import { describe, expect, test } from "bun:test";

import { answeredGates, homeScreenNeeded } from "./browser";

const iPhone =
	"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const mac =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

describe("homeScreenNeeded", () => {
	test("an iPhone in a browser tab needs the Home Screen", () => {
		expect(
			homeScreenNeeded({
				userAgent: iPhone,
				platform: "iPhone",
				maxTouchPoints: 5,
				standalone: false,
			}),
		).toBe(true);
	});

	test("an iPad that asks for the desktop site needs it too", () => {
		expect(
			homeScreenNeeded({
				userAgent: mac,
				platform: "MacIntel",
				maxTouchPoints: 5,
				standalone: false,
			}),
		).toBe(true);
	});

	test("Night Shift opened from the Home Screen does not", () => {
		expect(
			homeScreenNeeded({
				userAgent: iPhone,
				platform: "iPhone",
				maxTouchPoints: 5,
				standalone: true,
			}),
		).toBe(false);
	});

	test("a Mac does not", () => {
		expect(
			homeScreenNeeded({
				userAgent: mac,
				platform: "MacIntel",
				maxTouchPoints: 0,
				standalone: false,
			}),
		).toBe(false);
	});
});

describe("answeredGates", () => {
	const gate = (tag: string, shownAt: number) => ({
		tag,
		data: { kind: "gate-opened", shownAt },
	});

	test("a Gate notification whose Gate no longer waits is answered", () => {
		expect(
			answeredGates(
				[gate("run-1:review", 10), gate("run-2:ship", 10)],
				new Set(["run-2:ship"]),
				100,
			),
		).toEqual(["run-1:review"]);
	});

	test("one shown after the read may be a Gate the read did not know yet", () => {
		expect(answeredGates([gate("run-1:review", 100)], new Set(), 100)).toEqual(
			[],
		);
	});

	test("a run's notification is never a Gate's", () => {
		expect(
			answeredGates(
				[{ tag: "run-1:end:4", data: { kind: "run-finished", shownAt: 1 } }],
				new Set(),
				100,
			),
		).toEqual([]);
	});
});
