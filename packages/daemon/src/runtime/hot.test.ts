import { describe, expect, test } from "bun:test";

import { hotSlots, oneStartAtATime } from "./hot";

/**
 * `bun --hot` makes the daemon again on each reload, in the same process:
 * each daemon names its slots again over the one registry. A test's
 * registry is a plain object in place of `globalThis`.
 */

type Worker = { id: number; stopped: boolean };
type Registry = {
	document?: { id: number; flushed: number };
	worker?: Worker;
	handover?: { released: number };
};

/** One daemon's start: a kept document, a replaced worker, a handover. */
async function start(registry: Registry, id: number, log: string[] = []) {
	const slots = hotSlots(registry);
	const document = await slots.keep(
		"document",
		() => ({ id, flushed: 0 }),
		(kept) => {
			log.push("flush");
			kept.flushed += 1;
		},
	);
	const worker = await slots.replace(
		"worker",
		() => ({ id, stopped: false }),
		(before) => {
			log.push(`stop ${before.id}`);
			before.stopped = true;
		},
	);
	slots.handOver("handover", (handover) => {
		log.push("release");
		handover.released += 1;
	});
	registry.handover ??= { released: 0 };
	return { slots, document, worker };
}

describe("the slots of a daemon across reloads", () => {
	test("a reload keeps a kept slot, and stops the one before of a replaced slot first", async () => {
		const registry: Registry = {};
		const first = await start(registry, 1);
		const log: string[] = [];
		const reloaded = await start(registry, 2, log);

		expect(reloaded.document).toBe(first.document);
		expect(reloaded.document.id).toBe(1);
		expect(first.worker.stopped).toBe(true);
		expect(reloaded.worker).toMatchObject({ id: 2, stopped: false });
		expect(registry.worker).toBe(reloaded.worker);
		// A reload neither flushes nor releases: that is the next start's work.
		expect(log).toEqual(["stop 1"]);
	});

	test("a stop stops the replaced slots first, then closes and releases the rest, and empties them", async () => {
		const registry: Registry = {};
		const log: string[] = [];
		const { slots, document, worker } = await start(registry, 1, log);
		const handover = registry.handover;

		await slots.stop();

		expect(log[0]).toBe("stop 1");
		expect(log.slice(1).sort()).toEqual(["flush", "release"]);
		expect(worker.stopped).toBe(true);
		expect(document.flushed).toBe(1);
		expect(handover?.released).toBe(1);
		expect(registry).toEqual({
			document: undefined,
			worker: undefined,
			handover: undefined,
		});

		// The next start in this process begins fresh.
		const again = await start(registry, 3);
		expect(again.document).not.toBe(document);
		expect(again.document.id).toBe(3);
	});

	test("a slot that fails to stop does not keep the others from stopping", async () => {
		const registry: Registry & { other?: Worker } = {};
		const slots = hotSlots(registry);
		await slots.replace(
			"worker",
			() => ({ id: 1, stopped: false }),
			() => {
				throw new Error("stuck");
			},
		);
		const other = await slots.replace(
			"other",
			() => ({ id: 2, stopped: false }),
			(value) => {
				value.stopped = true;
			},
		);
		const errors = console.error;
		console.error = () => {};
		try {
			await slots.stop();
		} finally {
			console.error = errors;
		}
		expect(other.stopped).toBe(true);
		expect(registry.worker).toBeUndefined();
	});

	test("a slot with nothing in it at the stop is left alone", async () => {
		const registry: Registry = {};
		const slots = hotSlots(registry);
		let released = 0;
		// The module that fills it never started.
		slots.handOver("handover", () => {
			released += 1;
		});
		await slots.stop();
		expect(released).toBe(0);
	});
});

describe("a replaced slot that is still made (a make that is not awaited)", () => {
	/** A worker whose make ends when the test says so, or when its signal aborts. */
	function slowWorker(id: number) {
		let done = () => {};
		let signal: AbortSignal | undefined;
		const make = (asked: AbortSignal) => {
			signal = asked;
			return new Promise<Worker>((resolve) => {
				done = () => resolve({ id, stopped: false });
				if (asked.aborted) done();
				asked.addEventListener("abort", () => done());
			});
		};
		return { make, done: () => done(), signal: () => signal };
	}
	const stopWorker = (worker: Worker) => {
		worker.stopped = true;
	};

	test("a stop aborts the make, waits for it, and stops what it made", async () => {
		const registry: Registry = {};
		const slots = hotSlots(registry);
		const slow = slowWorker(1);
		const made = slots.replace("worker", slow.make, stopWorker);

		await slots.stop();

		expect(slow.signal()?.aborted).toBe(true);
		const worker = await made;
		expect(worker.stopped).toBe(true);
		expect(registry.worker).toBeUndefined();
	});

	test("a later start waits for an earlier make of the slot, and stops what it made first", async () => {
		const registry: Registry = {};
		const slow = slowWorker(1);
		const earlier = hotSlots(registry).replace("worker", slow.make, stopWorker);
		const later = hotSlots(registry).replace(
			"worker",
			() => ({ id: 2, stopped: false }),
			stopWorker,
		);
		await Bun.sleep(0);
		slow.done();

		const [first, second] = await Promise.all([earlier, later]);
		expect(first.stopped).toBe(true);
		expect(second).toMatchObject({ id: 2, stopped: false });
		expect(registry.worker).toBe(second);
	});
});

describe("two reloads at once (two saves in a row)", () => {
	type Starts = Registry & { nightshiftDaemonStart?: Promise<void> };

	/** A start whose stop and make take a while, as the daemon's do. */
	function slowStart(registry: Starts, id: number, made: Worker[]) {
		return oneStartAtATime(registry, async () => {
			const slots = hotSlots(registry);
			return slots.replace(
				"worker",
				async () => {
					await Bun.sleep(20);
					const worker = { id, stopped: false };
					made.push(worker);
					return worker;
				},
				async (before) => {
					await Bun.sleep(20);
					before.stopped = true;
				},
			);
		});
	}

	test("the second start waits for the first: every worker but the newest stops", async () => {
		const first = { id: 1, stopped: false };
		const registry: Starts = { worker: first };
		const made: Worker[] = [];
		await Promise.all([
			slowStart(registry, 2, made),
			slowStart(registry, 3, made),
		]);
		expect(first.stopped).toBe(true);
		expect(made.map((w) => [w.id, w.stopped])).toEqual([
			[2, true],
			[3, false],
		]);
		expect(registry.worker?.id).toBe(3);
	});

	test("a start that failed does not hold up the next one", async () => {
		const registry: Starts = {};
		const failed = oneStartAtATime(registry, async () => {
			throw new Error("The start failed.");
		});
		await expect(failed).rejects.toThrow("The start failed.");
		expect(await oneStartAtATime(registry, async () => "next")).toBe("next");
	});
});
