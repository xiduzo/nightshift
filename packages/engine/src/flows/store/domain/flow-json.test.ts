import { describe, expect, test } from "bun:test";
import { FLOW_VERSION } from "@nightshift/flows";
import { formatOf, readableRevision, revisionKinds, same } from "./flow-json";

describe("flow JSON", () => {
	test("the same JSON whatever the order of the keys", () => {
		expect(same({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 })).toBe(
			true,
		);
		expect(same([1, 2], [2, 1])).toBe(false);
	});

	test("a format next to this one", () => {
		expect(formatOf(FLOW_VERSION - 1)).toBe("older");
		expect(formatOf(FLOW_VERSION)).toBe("current");
		expect(formatOf(FLOW_VERSION + 1)).toBe("newer");
	});

	test("a revision of an older format is listed, of every kind, upgrade too", () => {
		for (const kind of revisionKinds) {
			const revision = {
				id: "r",
				at: 1,
				personId: null,
				deviceId: "laptop",
				kind,
				flow: { version: 1, anything: true },
			};
			expect(readableRevision(revision)).toEqual(revision);
		}
		expect(revisionKinds).toContain("upgrade");
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
