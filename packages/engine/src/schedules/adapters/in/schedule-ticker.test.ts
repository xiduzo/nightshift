import { afterEach, describe, expect, spyOn, test } from "bun:test";
import {
	createScheduleTicker,
	DEFAULT_SCHEDULE_TICK_MS,
	type ScheduleTick,
	type ScheduleTicker,
} from "./schedule-ticker";

/** The ticker of the scheduler, with a look the test ends by hand. */

const TICK_MS = 5;

/** Looks that stay under way until the test ends them. */
function looks() {
	const open: { tick: ScheduleTick; end(error?: unknown): void }[] = [];
	let count = 0;
	return {
		/** How many looks began. */
		get count() {
			return count;
		},
		fire(tick: ScheduleTick): Promise<void> {
			count++;
			return new Promise<void>((resolve, reject) => {
				open.push({
					tick,
					end: (error) => (error === undefined ? resolve() : reject(error)),
				});
			});
		},
		/** Ends the oldest look under way. */
		end(error?: unknown): void {
			const look = open.shift();
			if (!look) throw new Error("No look is under way.");
			look.end(error);
		},
		/** The look under way, as it sees the ticker. */
		current(): ScheduleTick {
			const look = open[0];
			if (!look) throw new Error("No look is under way.");
			return look.tick;
		},
	};
}

/** Lets the promise callbacks that are due run. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Waits until `done` holds, for at most 5,000 short waits. */
async function until(done: () => boolean, label: string): Promise<void> {
	for (let waits = 0; !done(); waits++) {
		if (waits > 5_000) throw new Error(`Timed out: ${label}`);
		await new Promise<void>((resolve) => setTimeout(resolve, 1));
	}
}

let tickers: ScheduleTicker[] = [];
afterEach(() => {
	for (const ticker of tickers) ticker.stop();
	tickers = [];
});

function ticker(fire: (tick: ScheduleTick) => Promise<void>): ScheduleTicker {
	const made = createScheduleTicker({ tickMs: TICK_MS, fire });
	tickers.push(made);
	return made;
}

describe("the scheduler's ticker", () => {
	test("looks every 30 seconds unless the engine says otherwise", () => {
		expect(DEFAULT_SCHEDULE_TICK_MS).toBe(30_000);
	});

	test("ticks never overlap: a second call waits for the look under way", async () => {
		const look = looks();
		const scheduler = ticker(look.fire);
		const first = scheduler.tick();
		const second = scheduler.tick();
		expect(second).toBe(first);
		expect(look.count).toBe(1);

		look.end();
		await first;
		const third = scheduler.tick();
		expect(look.count).toBe(2);
		look.end();
		await third;
	});

	test("a hold waits for the look under way, and the looks during it see the hold", async () => {
		const look = looks();
		const scheduler = ticker(look.fire);
		const ticking = scheduler.tick();
		expect(look.current().held()).toBe(false);

		let held = false;
		const holding = scheduler.hold().then((release) => {
			held = true;
			return release;
		});
		await settle();
		expect(held).toBe(false);
		// The look under way sees the hold at once: it starts no further run.
		expect(look.current().held()).toBe(true);

		look.end();
		await ticking;
		const release = await holding;
		expect(held).toBe(true);

		// A look during the hold is told of it. What it does then is the use case's.
		const during = scheduler.tick();
		expect(look.current().held()).toBe(true);
		look.end();
		await during;

		release();
		const after = scheduler.tick();
		expect(look.current().held()).toBe(false);
		look.end();
		await after;
	});

	test("the release ticks at once when the ticker runs, and is safe to call twice", async () => {
		const look = looks();
		const scheduler = ticker(look.fire);
		// A long interval: only the start and the release tick here.
		const slow = createScheduleTicker({ tickMs: 60_000, fire: look.fire });
		tickers.push(slow);
		slow.start();
		expect(look.count).toBe(1);
		look.end();
		await settle();

		const release = await slow.hold();
		expect(look.count).toBe(1);
		release();
		expect(look.count).toBe(2);
		release();
		expect(look.count).toBe(2);
		look.end();
		await settle();

		// A ticker that never started does not tick on a release.
		const idle = await scheduler.hold();
		idle();
		expect(look.count).toBe(2);
	});

	test("two holds need two releases", async () => {
		const look = looks();
		const scheduler = ticker(look.fire);
		const first = await scheduler.hold();
		const second = await scheduler.hold();
		first();
		const still = scheduler.tick();
		expect(look.current().held()).toBe(true);
		look.end();
		await still;
		second();
		const free = scheduler.tick();
		expect(look.current().held()).toBe(false);
		look.end();
		await free;
	});

	test("start looks at once, then at every tick, until stop", async () => {
		let count = 0;
		const scheduler = ticker(async () => {
			count++;
		});
		scheduler.start();
		expect(count).toBe(1);
		await until(() => count >= 3, "three looks");

		scheduler.stop();
		const stoppedAt = count;
		await new Promise<void>((resolve) => setTimeout(resolve, TICK_MS * 4));
		expect(count).toBe(stoppedAt);
	});

	test("a second start changes nothing, and a stop is for good", async () => {
		let count = 0;
		const scheduler = ticker(async () => {
			count++;
		});
		scheduler.start();
		scheduler.start();
		expect(count).toBe(1);
		scheduler.stop();
		scheduler.start();
		await new Promise<void>((resolve) => setTimeout(resolve, TICK_MS * 4));
		expect(count).toBe(1);
	});

	test("the signal stops it: no look starts after the abort", async () => {
		let count = 0;
		const scheduler = ticker(async () => {
			count++;
		});
		const controller = new AbortController();
		scheduler.start(controller.signal);
		await until(() => count >= 2, "two looks");
		controller.abort();
		const stoppedAt = count;
		await new Promise<void>((resolve) => setTimeout(resolve, TICK_MS * 4));
		expect(count).toBe(stoppedAt);
	});

	test("a signal that aborted before the start keeps it from starting, for good", async () => {
		let count = 0;
		const scheduler = ticker(async () => {
			count++;
		});
		const controller = new AbortController();
		controller.abort();
		scheduler.start(controller.signal);
		scheduler.start();
		await new Promise<void>((resolve) => setTimeout(resolve, TICK_MS * 4));
		expect(count).toBe(0);
	});

	test("the look under way sees a stop", async () => {
		const look = looks();
		const scheduler = ticker(look.fire);
		const ticking = scheduler.tick();
		expect(look.current().stopped()).toBe(false);
		scheduler.stop();
		expect(look.current().stopped()).toBe(true);
		look.end();
		await ticking;
	});

	test("a look that fails is logged, and the next look runs", async () => {
		const logged = spyOn(console, "error").mockImplementation(() => {});
		try {
			const look = looks();
			const scheduler = ticker(look.fire);
			const failing = scheduler.tick();
			look.end(new Error("the database is gone"));
			await failing;
			expect(logged).toHaveBeenCalledTimes(1);
			expect(logged.mock.calls[0]?.[0]).toBe(
				"[nightshift] The scheduler tick failed:",
			);

			const next = scheduler.tick();
			expect(look.count).toBe(2);
			look.end();
			await next;
		} finally {
			logged.mockRestore();
		}
	});

	test("a look that fails after a stop is not logged", async () => {
		const logged = spyOn(console, "error").mockImplementation(() => {});
		try {
			const look = looks();
			const scheduler = ticker(look.fire);
			const failing = scheduler.tick();
			scheduler.stop();
			look.end(new Error("the database is gone"));
			await failing;
			expect(logged).not.toHaveBeenCalled();
		} finally {
			logged.mockRestore();
		}
	});
});
