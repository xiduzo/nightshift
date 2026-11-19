import { afterEach, describe, expect, test } from "bun:test";
import { NIGHT_SHIFT } from "../../../../contract";
import { RunRefusal } from "../../../../run-status";
import type { Walkers } from "../../application/ports";

/** A Command as a Host carries it to the Walker. */
export type CarriedCommand = {
	kind: string;
	payload: unknown;
	spaceId: string;
	runId: string;
	walkerId: string;
	personId: string;
};

/** One adapter of `Walkers` to test. */
export type WalkersUnderTest = {
	walkers: Walkers;
	/** The Commands the Host took, in order. */
	carried(): CarriedCommand[];
	/** The Walker applied the run's Commands. */
	done(runId: string): Promise<void>;
	close(): Promise<void>;
};

const RUN = { id: "run-1", spaceId: "space-1", walkerId: "device-far" };
const ADA = { personId: "person-ada" };

/** What a refused promise threw. */
const refusalOf = (work: Promise<unknown>) =>
	work.then(
		() => null,
		(error: unknown) => error,
	);

/**
 * What every adapter of `Walkers` does. `walkers.contract.test.ts` runs
 * it on the in-memory adapter and on the one over a Host's relay.
 * `make(false)` gives one that reaches no Host.
 */
export function walkersContract(
	name: string,
	make: (reachable: boolean) => Promise<WalkersUnderTest>,
): void {
	describe(`Walkers contract: ${name}`, () => {
		let under: WalkersUnderTest | null = null;
		afterEach(async () => {
			await under?.close();
			under = null;
		});

		test("without a Host to reach, a Command is refused: the Walker is out of reach", async () => {
			under = await make(false);
			const refused = await refusalOf(
				under.walkers.send(RUN, ADA, {
					kind: "run.stop",
					payload: { when: "now" },
				}),
			);
			expect(refused).toBeInstanceOf(RunRefusal);
			expect((refused as RunRefusal).rule).toBe("walker-unreachable");
			expect((refused as RunRefusal).message).toBe(
				"Another device runs this run, and this computer cannot reach it.",
			);
			expect(under.carried()).toEqual([]);
		});

		test("without a Person, a Command is refused: sign in", async () => {
			under = await make(true);
			const refused = await refusalOf(
				under.walkers.send(RUN, NIGHT_SHIFT, {
					kind: "run.stop",
					payload: { when: "now" },
				}),
			);
			expect(refused).toBeInstanceOf(RunRefusal);
			expect((refused as RunRefusal).rule).toBe("signed-out");
			expect((refused as RunRefusal).message).toBe(
				"Sign in to act on this run.",
			);
			expect(under.carried()).toEqual([]);
		});

		test("the Command carries the run's Space, its Walker and the Person", async () => {
			under = await make(true);
			await under.walkers.send(RUN, ADA, {
				kind: "run.stop",
				payload: { when: "now" },
			});
			expect(under.carried()).toEqual([
				{
					kind: "run.stop",
					payload: { when: "now" },
					spaceId: "space-1",
					runId: "run-1",
					walkerId: "device-far",
					personId: "person-ada",
				},
			]);
		});

		test("a sent Command waits for the Walker until it is applied", async () => {
			under = await make(true);
			expect(await under.walkers.pending("run-1")).toEqual([]);
			await under.walkers.send(RUN, ADA, { kind: "run.resume", payload: {} });
			expect(await under.walkers.pending("run-1")).toEqual(["run.resume"]);
			expect(await under.walkers.pending("run-2")).toEqual([]);
			await under.done("run-1");
			expect(await under.walkers.pending("run-1")).toEqual([]);
		});
	});
}
