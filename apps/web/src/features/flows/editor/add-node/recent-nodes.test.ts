import { describe, expect, test } from "bun:test";
import {
	RECENT_MAX,
	RECENT_START,
	readRecent,
	withRecent,
} from "./recent-nodes";

describe("recent nodes", () => {
	test("the newest comes first, once", () => {
		expect(withRecent(["agent", "gate", "value"], "gate")).toEqual([
			"gate",
			"agent",
			"value",
		]);
	});

	test("the list keeps at most RECENT_MAX", () => {
		let list = withRecent([], "agent");
		for (const item of [
			"command",
			"tool",
			"web-request",
			"gate",
			"branch",
			"value",
			"convert",
			"wait",
			"end",
		] as const)
			list = withRecent(list, item);
		expect(list).toHaveLength(RECENT_MAX);
		expect(list[0]).toBe("end");
		expect(list).not.toContain("agent");
	});

	test("a kept list drops node types that are gone, and doubles", () => {
		expect(readRecent(JSON.stringify(["gate", "gone", "gate", "end"]))).toEqual(
			["gate", "end"],
		);
	});

	test("nothing kept, or nothing valid, starts over", () => {
		expect(readRecent(null)).toEqual([...RECENT_START]);
		expect(readRecent("not json")).toEqual([...RECENT_START]);
		expect(readRecent(JSON.stringify({ agent: true }))).toEqual([
			...RECENT_START,
		]);
		expect(readRecent(JSON.stringify(["gone"]))).toEqual([...RECENT_START]);
	});
});
