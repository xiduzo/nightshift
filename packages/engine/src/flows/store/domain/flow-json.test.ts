import { describe, expect, test } from "bun:test";
import { FLOW_VERSION } from "@nightshift/flows";
import { olderFormat, readableRevision, same } from "./flow-json";

describe("flow JSON", () => {
	test("the same JSON whatever the order of the keys", () => {
		expect(same({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 })).toBe(
			true,
		);
		expect(same([1, 2], [2, 1])).toBe(false);
	});

	test("a flow of an older format", () => {
		expect(olderFormat({ version: FLOW_VERSION - 1 })).toBe(true);
		expect(olderFormat({ version: FLOW_VERSION })).toBe(false);
		expect(olderFormat("nope")).toBe(false);
	});

	test("a revision of a newer Night Shift, or one that does not read, is left out", () => {
		const revision = {
			id: "r",
			at: 1,
			personId: null,
			deviceId: "laptop",
			kind: "save" as const,
			flow: { version: FLOW_VERSION },
		};
		expect(readableRevision(revision)).toEqual(revision);
		expect(
			readableRevision({ ...revision, flow: { version: FLOW_VERSION + 1 } }),
		).toBeNull();
		expect(readableRevision({ ...revision, kind: "later" })).toBeNull();
	});
});
