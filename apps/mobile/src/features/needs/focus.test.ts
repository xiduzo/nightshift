/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type { OpenGate, RunSummary } from "@nightshift/client";

import {
	FOCUS_START,
	type FocusState,
	focusOrder,
	focusView,
	handle,
	release,
	skip,
} from "./focus";
import type { NeedsItem } from "./queue";

function gate(runId: string, openedAt = 0): NeedsItem {
	return {
		kind: "gate",
		key: `gate:${runId}:s1`,
		gate: { runId, stepId: "s1", openedAt } as OpenGate,
	};
}

function run(id: string, endedAt = 100): NeedsItem {
	return {
		kind: "run",
		key: `run:${id}`,
		run: { id, endedAt, createdAt: 0 } as RunSummary,
	};
}

/** Shows the queue once, and keeps what the screen keeps. */
function settle(state: FocusState, items: readonly NeedsItem[]) {
	const view = focusView(state, items);
	return { view, state: view.settled ?? state };
}

const keys = (items: readonly NeedsItem[]) => items.map((item) => item.key);

describe("focusView", () => {
	test("the first of the queue shows, with its place", () => {
		const { view, state } = settle(FOCUS_START, [gate("a"), run("x")]);
		expect(view.current?.key).toBe("gate:a:s1");
		expect([view.position, view.total]).toEqual([1, 2]);
		expect(state.pinned).toEqual({ key: "gate:a:s1", kind: "gate" });
	});

	test("nothing waits: nothing shows", () => {
		const view = focusView(FOCUS_START, []);
		expect(view.current).toBeNull();
		expect([view.position, view.total]).toEqual([0, 0]);
		expect(view.settled).toBeNull();
	});

	test("a new Gate that comes first does not replace the one you read", () => {
		let { state } = settle(FOCUS_START, [gate("a"), run("x")]);
		const { view } = settle(state, [gate("new"), gate("a"), run("x")]);
		expect(view.current?.key).toBe("gate:a:s1");
		expect([view.position, view.total]).toEqual([2, 3]);
		expect(view.settled).toBeNull();
		// Answered: the first of the queue shows, the new Gate.
		state = handle(state, gate("a"));
		expect(
			settle(state, [gate("new"), gate("a"), run("x")]).view.current?.key,
		).toBe("gate:new:s1");
	});

	test("the thing you read leaves the queue: the first shows, and it says so", () => {
		const { state } = settle(FOCUS_START, [gate("a"), gate("b")]);
		const { view, state: next } = settle(state, [gate("b")]);
		expect(view.current?.key).toBe("gate:b:s1");
		expect(view.vanished).toBe("gate");
		expect(focusView(next, [gate("b")]).vanished).toBeNull();
	});
});

describe("skip", () => {
	test("moves the thing to the end, and the first of the queue shows", () => {
		const items = [gate("a"), gate("b"), run("x")];
		let { state } = settle(FOCUS_START, items);
		state = skip(state, "gate:a:s1");
		expect(keys(focusOrder(state, items))).toEqual([
			"gate:b:s1",
			"run:x",
			"gate:a:s1",
		]);
		const { view } = settle(state, items);
		expect(view.current?.key).toBe("gate:b:s1");
		expect([view.position, view.total]).toEqual([1, 3]);
		expect(view.vanished).toBeNull();
	});

	test("skipping each in turn goes round the queue", () => {
		const items = [gate("a"), gate("b"), gate("c")];
		let { state } = settle(FOCUS_START, items);
		const seen: string[] = [];
		for (let turn = 0; turn < 4; turn++) {
			const { view, state: shown } = settle(state, items);
			seen.push(view.current?.key ?? "");
			state = skip(shown, view.current?.key ?? "");
		}
		expect(seen).toEqual(["gate:a:s1", "gate:b:s1", "gate:c:s1", "gate:a:s1"]);
	});

	test("a skipped thing that leaves the queue is forgotten", () => {
		let { state } = settle(FOCUS_START, [gate("a"), gate("b")]);
		state = skip(state, "gate:a:s1");
		({ state } = settle(state, [gate("b")]));
		expect(state.skipped).toEqual([]);
	});
});

describe("handle", () => {
	test("a thing you handled stays out while the live data still holds it", () => {
		const items = [run("x"), run("y")];
		let { state } = settle(FOCUS_START, items);
		state = handle(state, run("x"));
		const { view } = settle(state, items);
		expect(view.current?.key).toBe("run:y");
		expect(view.total).toBe(1);
		expect(view.vanished).toBeNull();
	});

	test("a run that stops again shows again", () => {
		let { state } = settle(FOCUS_START, [run("x", 100)]);
		state = handle(state, run("x", 100));
		expect(focusView(state, [run("x", 100)]).current).toBeNull();
		expect(focusView(state, [run("x", 200)]).current?.key).toBe("run:x");
	});
});

describe("release", () => {
	test("a run you left goes without a notice, and comes back on Undo", () => {
		const items = [run("x"), run("y")];
		let { state } = settle(FOCUS_START, items);
		state = release(state);
		const left = settle(state, [run("y")]);
		expect(left.view.current?.key).toBe("run:y");
		expect(left.view.vanished).toBeNull();
		// Undo: the run is back in its place, the one on screen stays.
		expect(focusView(left.state, items).current?.key).toBe("run:y");
	});
});
