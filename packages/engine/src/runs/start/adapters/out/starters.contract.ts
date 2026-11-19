import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { RunRow } from "../../../../log";
import type { Starters } from "../../application/ports";

/** One adapter of `Starters` to test, over the Persons and the runs of one Replica. */
export type StartersUnderTest = {
	starters: Starters;
	/** What this computer calls itself. */
	selfName: string;
	/** A Person of this Replica, with their name and email. */
	person(id: string, name: string, email: string): Promise<void>;
	/** A run this computer started and walks, for the Person: its row. */
	started(runId: string, personId: string): Promise<RunRow>;
	close(): Promise<void>;
};

/**
 * What every adapter of `Starters` does. `starters.contract.test.ts` runs
 * it on the in-memory adapter and on the one over the read model.
 */
export function startersContract(
	name: string,
	make: () => Promise<StartersUnderTest>,
): void {
	describe(`Starters contract: ${name}`, () => {
		let under: StartersUnderTest;
		beforeEach(async () => {
			under = await make();
		});
		afterEach(async () => {
			await under.close();
		});

		test("a Person with a real email commits in their name, one without a real email as nobody", async () => {
			await under.person("person-carol", "Carol", "carol@example.com");
			await under.person("person-local", "Local", "kim@nightshift.invalid");
			expect(await under.starters.gitAuthor("person-carol")).toEqual({
				name: "Carol",
				email: "carol@example.com",
			});
			expect(await under.starters.gitAuthor("person-local")).toBeNull();
			expect(await under.starters.gitAuthor("person-nobody")).toBeNull();
		});

		test("a run's summary names this computer as its Walker, and its Device", async () => {
			await under.person("person-carol", "Carol", "carol@example.com");
			const row = await under.started("run-1", "person-carol");
			const here = await under.starters.summary(row, {
				id: row.walkerId,
				name: "whatever",
			});
			expect(here).toMatchObject({
				id: "run-1",
				walker: { id: row.walkerId, name: under.selfName, thisDevice: true },
				device: { id: row.walkerId, name: under.selfName, thisDevice: true },
			});
			const elsewhere = await under.starters.summary(row, {
				id: "laptop",
				name: "Laptop",
			});
			expect(elsewhere.device).toEqual({
				id: "laptop",
				name: "Laptop",
				thisDevice: false,
			});
		});
	});
}
