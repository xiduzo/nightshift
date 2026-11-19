import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Refusal } from "@nightshift/refusal";
import type { Turns } from "../../application/ports";

/** What a released runner says to a Turn (`RELEASED` of `graph/runner/turn.ts`). */
const RELEASED = "Night Shift is restarting. Try again in a moment.";

/** One adapter of `Turns` to test, over one run this computer walks, with no drive. */
export type TurnsUnderTest = {
	turns: Turns;
	runId: string;
	/** The run's status now. */
	status(): Promise<string>;
	/** What the run has been handed so far: its events, or the intents taken. */
	handedOn(): Promise<number>;
	/** Lets go of every run, as a daemon that stops. */
	release(): Promise<void>;
	close(): Promise<void>;
};

/** A promise and the function that settles it. */
function latch() {
	let open = () => {};
	const opened = new Promise<void>((resolve) => {
		open = resolve;
	});
	return { opened, open };
}

/**
 * What every adapter of `Turns` does. The twin walks nothing, so the
 * suite holds only what both do: the order of the Turns, the check, what
 * `hold` gives, and the refusals. What a drive does to the log stays in
 * the tests of `graph`. `turns.contract.test.ts` runs it on the in-memory
 * adapter and on the runner.
 */
export function turnsContract(
	name: string,
	make: () => Promise<TurnsUnderTest>,
): void {
	describe(`Turns contract: ${name}`, () => {
		let under: TurnsUnderTest;
		let R: string;
		beforeEach(async () => {
			under = await make();
			R = under.runId;
		});
		afterEach(async () => {
			await under.close();
		});

		test("hold gives the row, the state and whether a drive holds the run", async () => {
			const status = await under.status();
			const held = await under.turns.hold(R, async (h) => h);
			expect(held.row.id).toBe(R);
			expect<string>(held.runState.status).toBe(status);
			expect(held.active).toBe(false);
			expect(under.turns.isActive(R)).toBe(false);
		});

		test("one Turn at a time per run, first in first out", async () => {
			const order: string[] = [];
			const entered = latch();
			const gate = latch();
			const first = under.turns.hold(R, async () => {
				order.push("first in");
				entered.open();
				await gate.opened;
				order.push("first out");
			});
			const second = under.turns.hold(R, async () => {
				order.push("second");
			});
			await entered.opened;
			await new Promise((resolve) => setTimeout(resolve, 10));
			expect(order).toEqual(["first in"]);
			gate.open();
			await Promise.all([first, second]);
			expect(order).toEqual(["first in", "first out", "second"]);
		});

		test("check runs first, on the state of that moment, and its throw rejects the Turn with nothing handed on", async () => {
			const status = await under.status();
			const before = await under.handedOn();
			let seen: string | null = null;
			const taking = under.turns.take(
				R,
				{ kind: "stop", by: "person" },
				{
					check: (state) => {
						seen = state.status;
						throw new Refusal("conflict", "Not now.");
					},
				},
			);
			await expect(taking).rejects.toThrow("Not now.");
			expect(seen === status).toBe(true);
			expect(await under.status()).toBe(status);
			expect(await under.handedOn()).toBe(before);
		});

		test("a Turn from inside a Turn of the same run throws", async () => {
			await expect(
				under.turns.hold(R, () => under.turns.hold(R, async () => "inner")),
			).rejects.toThrow("cannot wait for another Turn of the same run");
			// The run takes Turns again after it.
			expect(await under.turns.hold(R, async () => "after")).toBe("after");
		});

		test("after a release, a Turn is refused", async () => {
			await under.release();
			const held = under.turns.hold(R, async () => "held");
			await expect(held).rejects.toBeInstanceOf(Refusal);
			await expect(held).rejects.toThrow(RELEASED);
			const taken = under.turns.take(R, { kind: "stop", by: "person" });
			await expect(taken).rejects.toBeInstanceOf(Refusal);
			await expect(taken).rejects.toThrow(RELEASED);
		});
	});
}
