import { describe, expect, test } from "bun:test";
import { FLOW_VERSION, type Flow, flowSchema } from "@nightshift/flows";
import {
	isFull,
	markCount,
	markNode,
	markOf,
	marksKey,
	marksText,
	NO_MARKS,
	parseMarks,
	pruneMarks,
	readMarks,
	TEST_MARKS_MAX,
	type TestMarks,
	testRequest,
	writeMarks,
} from "./marks";

const flow: Flow = flowSchema.parse({
	version: FLOW_VERSION,
	start: "fetch",
	nodes: [
		{
			id: "fetch",
			type: "web-request",
			position: { x: 0, y: 0 },
			method: "GET",
			url: "https://example.com/feed",
		},
		{
			id: "approve",
			type: "decision",
			position: { x: 300, y: 0 },
			by: "person",
			prompt: "Send the summary?",
			options: [{ name: "send" }, { name: "hold" }],
		},
		{ id: "done", type: "end", position: { x: 600, y: 0 }, status: "done" },
	],
	edges: [],
});

const pin = { runId: "run-1", stepId: "step-1" };

/** A storage in memory, like the browser's. */
function memoryStorage() {
	const items = new Map<string, string>();
	return {
		items,
		getItem: (key: string) => items.get(key) ?? null,
		setItem: (key: string, value: string) => void items.set(key, value),
		removeItem: (key: string) => void items.delete(key),
	};
}

describe("the marks this browser keeps", () => {
	test("one key per project and flow", () => {
		expect(marksKey("p1", "watch-prices")).toBe(
			"nightshift:test:p1:watch-prices",
		);
	});

	test("a write and a read give the same marks", () => {
		const storage = memoryStorage();
		const marks: TestMarks = {
			pinned: { fetch: pin },
			skipped: { approve: "send" },
		};
		writeMarks(storage, "k", marks);
		expect(readMarks(storage, "k")).toEqual(marks);
	});

	test("no marks keep nothing", () => {
		const storage = memoryStorage();
		storage.setItem("k", "{}");
		writeMarks(storage, "k", NO_MARKS);
		expect(storage.items.has("k")).toBe(false);
	});

	test("a storage that throws, or none, gives no marks", () => {
		const broken = {
			getItem: () => {
				throw new Error("blocked");
			},
			setItem: () => {
				throw new Error("blocked");
			},
			removeItem: () => {
				throw new Error("blocked");
			},
		};
		expect(readMarks(broken, "k")).toEqual(NO_MARKS);
		expect(() =>
			writeMarks(broken, "k", { pinned: { fetch: pin }, skipped: {} }),
		).not.toThrow();
		expect(readMarks(undefined, "k")).toEqual(NO_MARKS);
	});

	test("what does not fit is left out", () => {
		expect(parseMarks("not json")).toEqual(NO_MARKS);
		expect(parseMarks("[1, 2]")).toEqual(NO_MARKS);
		expect(
			parseMarks(
				JSON.stringify({
					pinned: {
						fetch: pin,
						bad: { runId: 1, stepId: "s" },
						empty: { runId: "", stepId: "s" },
					},
					skipped: { approve: "send", other: 3, fetch: "pass" },
				}),
			),
		).toEqual({ pinned: { fetch: pin }, skipped: { approve: "send" } });
	});
});

describe("the marks that fit the draft", () => {
	test("a node the draft lost, an End, an outcome it lost", () => {
		const marks: TestMarks = {
			pinned: { fetch: pin, gone: pin, done: pin },
			skipped: { approve: "maybe" },
		};
		expect(pruneMarks(marks, flow)).toEqual({
			pinned: { fetch: pin },
			skipped: {},
		});
	});

	test("marks that all fit stay the same object", () => {
		const marks: TestMarks = {
			pinned: { fetch: pin },
			skipped: { approve: "send" },
		};
		expect(pruneMarks(marks, flow)).toBe(marks);
	});
});

describe("a mark on a node", () => {
	test("a node is pinned or skipped, never both", () => {
		const pinned = markNode(NO_MARKS, "approve", { kind: "pinned", pin });
		expect(markOf(pinned, "approve")).toEqual({ kind: "pinned", pin });
		const skipped = markNode(pinned, "approve", {
			kind: "skipped",
			outcome: "send",
		});
		expect(skipped).toEqual({ pinned: {}, skipped: { approve: "send" } });
		expect(markNode(skipped, "approve", null)).toEqual(NO_MARKS);
		expect(markOf(NO_MARKS, "approve")).toBeNull();
	});

	test("at most 50 marks, but a marked node can change its mark", () => {
		const pinned = Object.fromEntries(
			Array.from({ length: TEST_MARKS_MAX }, (_, index) => [
				`node-${index}`,
				pin,
			]),
		);
		const full: TestMarks = { pinned, skipped: {} };
		expect(isFull(full, "one-more")).toBe(true);
		expect(isFull(full, "node-0")).toBe(false);
		expect(isFull(NO_MARKS, "one-more")).toBe(false);
	});

	test("the count in a few words", () => {
		const marks: TestMarks = {
			pinned: { fetch: pin, read: pin },
			skipped: { approve: "send" },
		};
		expect(marksText(markCount(marks))).toBe("2 pinned · 1 skipped");
		expect(marksText(markCount({ pinned: {}, skipped: { a: "pass" } }))).toBe(
			"1 skipped",
		);
	});
});

describe("the start of a test run", () => {
	test("carries the pins and the skips it has", () => {
		expect(
			testRequest({ pinned: { fetch: pin }, skipped: { approve: "send" } }),
		).toEqual({ pinned: { fetch: pin }, skipped: { approve: "send" } });
		expect(testRequest({ pinned: {}, skipped: { approve: "send" } })).toEqual({
			skipped: { approve: "send" },
		});
	});

	test("no marks: no test run", () => {
		expect(testRequest(NO_MARKS)).toBeUndefined();
	});
});
