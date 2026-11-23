import { describe, expect, test } from "bun:test";
import {
	createBundles,
	createPruneClock,
	createSerialQueue,
	PRUNE_EVERY_MS,
} from "./notifier-state";

describe("the state of the notifier", () => {
	test("the queue runs one job after the other, and a failed one does not stop the next", async () => {
		const errors: string[] = [];
		const done: string[] = [];
		const queue = createSerialQueue((what) => errors.push(what));
		void queue.enqueue("first", async () => {
			await Promise.resolve();
			done.push("first");
		});
		void queue.enqueue("broken", async () => {
			throw new Error("no");
		});
		await queue.enqueue("last", async () => {
			done.push("last");
		});
		await queue.idle();
		expect(done).toEqual(["first", "last"]);
		expect(errors).toEqual(["broken"]);
	});

	test("a bundle is withdrawn when the last Gate it names closes", () => {
		const bundles = createBundles();
		bundles.add({
			targetId: "t",
			key: "waiting:1",
			gates: new Set(["a", "b"]),
		});
		expect(bundles.closed("a")).toEqual([]);
		expect(bundles.closed("b").map((b) => b.key)).toEqual(["waiting:1"]);
		expect(bundles.closed("b")).toEqual([]);
	});

	test("the log is pruned at most once an hour", () => {
		const pruning = createPruneClock();
		expect(pruning.due(0)).toBe(true);
		expect(pruning.due(PRUNE_EVERY_MS - 1)).toBe(false);
		expect(pruning.due(PRUNE_EVERY_MS)).toBe(true);
	});
});
