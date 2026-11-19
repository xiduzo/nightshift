import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { RunFacts } from "../../application/ports";

/** One adapter of `RunFacts` to test, over one run that started. */
export type RunFactsUnderTest = {
	facts: RunFacts;
	/** A run of this Replica: its log has its `RunStarted`. */
	runId: string;
	/** This computer's id as the Walker. */
	walkerId: string;
	/** Calls `listener` on each change the facts tell of the run. Returns the unsubscribe. */
	watch(runId: string, listener: () => void): () => void;
	close(): Promise<void>;
};

/**
 * What every adapter of `RunFacts` does. `run-facts.contract.test.ts`
 * runs it on the in-memory adapter and on the one over the run log.
 */
export function runFactsContract(
	name: string,
	make: () => Promise<RunFactsUnderTest>,
): void {
	describe(`RunFacts contract: ${name}`, () => {
		let under: RunFactsUnderTest;
		let R: string;
		beforeEach(async () => {
			under = await make();
			R = under.runId;
		});
		afterEach(async () => {
			await under.close();
		});

		const stopAfterStep = (runId: string) => ({
			runId,
			type: "StopAfterStepRequested" as const,
			payload: {},
		});

		test("append returns the event with its seq", async () => {
			const before = await under.facts.events(R);
			const logged = await under.facts.append(stopAfterStep(R));
			expect(logged.type).toBe("StopAfterStepRequested");
			expect(logged.runId).toBe(R);
			expect(logged.seq).toBeGreaterThan(before.at(-1)?.seq ?? 0);
			expect((await under.facts.events(R)).at(-1)).toEqual(logged);
		});

		test("the state is the fold after each append", async () => {
			expect((await under.facts.state(R)).status).toBe("running");
			expect((await under.facts.state(R)).stopAfterStep).toBe(false);
			await under.facts.append(stopAfterStep(R));
			expect((await under.facts.state(R)).stopAfterStep).toBe(true);
		});

		test("two appends keep their order", async () => {
			const first = await under.facts.append(stopAfterStep(R));
			const second = await under.facts.append({
				runId: R,
				type: "StopAfterStepCancelled",
				payload: {},
			});
			expect(second.seq).toBeGreaterThan(first.seq);
			const events = await under.facts.events(R);
			expect(events.slice(-2).map((e) => e.type)).toEqual([
				"StopAfterStepRequested",
				"StopAfterStepCancelled",
			]);
			expect((await under.facts.state(R)).stopAfterStep).toBe(false);
		});

		test("changed reaches a watcher of the run, and only of that run", async () => {
			const seen: string[] = [];
			const off = under.watch(R, () => seen.push(R));
			const other = under.watch("run-other", () => seen.push("run-other"));
			under.facts.changed(R);
			expect(seen).toEqual([R]);
			off();
			other();
			under.facts.changed(R);
			expect(seen).toEqual([R]);
		});

		test("the Walker is this computer", async () => {
			expect(await under.facts.walkerId()).toBe(under.walkerId);
		});
	});
}
