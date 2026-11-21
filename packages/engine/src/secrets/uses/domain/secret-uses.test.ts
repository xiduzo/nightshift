import { describe, expect, test } from "bun:test";
import { dueUses, notRead } from "./secret-uses";

/** When a use is written, and which scopes a use could not read. */

describe("dueUses", () => {
	test("a name is due when never used or not in the last minute", () => {
		const used = new Map([
			["OLD", 0],
			["NEW", 100_000],
		]);
		expect(dueUses(used, ["NEW"], 120_000)).toBeNull();
		expect(dueUses(used, ["OLD", "FRESH", "OLD"], 120_000)).toEqual(
			new Map([
				["OLD", 120_000],
				["NEW", 100_000],
				["FRESH", 120_000],
			]),
		);
	});
});

describe("notRead", () => {
	test("only the flags that are set", () => {
		const resolved = {
			vars: {},
			fromProject: new Set<string>(),
			unreachable: true,
			projectUnreachable: false,
			personalHere: false,
		};
		expect(notRead(resolved)).toEqual({ unreachable: true });
	});
});
