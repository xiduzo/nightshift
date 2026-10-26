import { describe, expect, test } from "bun:test";
import { type Flow, moveNode, newFlow } from "@nightshift/flows";
import { record, redo, startHistory, undo } from "./draft-history";

const start = newFlow();
const id = start.nodes[0]?.id ?? "";
const moved = (x: number): Flow => moveNode(start, id, { x, y: 0 });
const drag = (at: number) => ({ key: "drag:1", at, within: 1000 });

describe("draft history", () => {
	test("undo and redo walk the steps", () => {
		let history = record(startHistory(start), moved(10));
		history = record(history, moved(20));
		history = undo(history);
		expect(history.present).toEqual(moved(10));
		history = undo(history);
		expect(history.present).toBe(start);
		expect(undo(history)).toBe(history);
		history = redo(history);
		expect(history.present).toEqual(moved(10));
		expect(history.future).toHaveLength(1);
	});

	test("a new change drops the steps Redo had", () => {
		let history = record(startHistory(start), moved(10));
		history = record(undo(history), moved(30));
		expect(history.future).toEqual([]);
		expect(redo(history)).toBe(history);
	});

	test("changes of one gesture merge into one step", () => {
		let history = record(startHistory(start), moved(10), drag(0));
		history = record(history, moved(20), drag(16));
		history = record(history, moved(30), drag(32));
		expect(history.past).toEqual([start]);
		expect(undo(history).present).toBe(start);
	});

	test("the same key merges no more after a pause, or after an undo", () => {
		let history = record(startHistory(start), moved(10), drag(0));
		history = record(history, moved(20), drag(2000));
		expect(history.past).toHaveLength(2);
		history = record(undo(history), moved(40), drag(2010));
		expect(history.past).toHaveLength(2);
	});

	test("a change to the same flow is no step", () => {
		const history = record(startHistory(start), moved(0));
		expect(history.past).toEqual([]);
	});
});
