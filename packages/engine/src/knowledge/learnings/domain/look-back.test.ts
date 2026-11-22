import { describe, expect, test } from "bun:test";
import { createLookQueue, runBefore } from "./look-back";

describe("runBefore", () => {
	const run = { id: "r3", flowName: "nightly", createdAt: 30 };

	test("is the newest run of the same flow that ended before it", () => {
		expect(
			runBefore(run, [
				{ id: "r3", flowName: "nightly", createdAt: 30, endedAt: 31 },
				{ id: "r1", flowName: "nightly", createdAt: 10, endedAt: 11 },
				{ id: "r2", flowName: "nightly", createdAt: 20, endedAt: 21 },
				{ id: "r4", flowName: "nightly", createdAt: 25, endedAt: null },
				{ id: "r5", flowName: "weekly", createdAt: 26, endedAt: 27 },
			])?.id,
		).toBe("r2");
	});

	test("a quick run, or one with none before it, has none", () => {
		expect(runBefore({ ...run, flowName: null }, [])).toBeNull();
		expect(runBefore(run, [])).toBeNull();
	});
});

describe("createLookQueue", () => {
	test("runs one look at a time, and a failure stops no later look", async () => {
		const queue = createLookQueue();
		const order: string[] = [];
		let release = () => {};
		const first = queue.add(
			() =>
				new Promise<void>((resolve) => {
					order.push("first starts");
					release = () => {
						order.push("first ends");
						resolve();
					};
				}),
		);
		const failed = queue.add(async () => {
			order.push("second");
			throw new Error("No model.");
		});
		const third = queue.add(async () => {
			order.push("third");
			return 3;
		});
		while (order.length === 0) await Promise.resolve();
		expect(order).toEqual(["first starts"]);
		release();
		await first;
		await expect(failed).rejects.toThrow("No model.");
		expect(await third).toBe(3);
		await queue.idle();
		expect(order).toEqual(["first starts", "first ends", "second", "third"]);
	});
});
