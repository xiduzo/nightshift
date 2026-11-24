import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { SavedProfiles } from "../../application/ports";
import type { ProfileEntry } from "../../domain/profile-entries";

/** One store to test: what an adapter of `SavedProfiles` gives the suite. */
export type SavedProfilesUnderTest = {
	saved: SavedProfiles;
	/** Puts a raw entry in, as an older version or another computer wrote it. */
	put(id: string, value: unknown): Promise<void>;
	close(): Promise<void>;
};

const agent: ProfileEntry = {
	name: "night",
	description: "The night's agent",
	settings: {
		harness: "claude-code",
		model: "sonnet",
		permissionMode: "acceptEdits",
		clis: [],
		connections: [],
	},
	updatedAt: 1000,
};

/**
 * What every adapter of `SavedProfiles` does.
 * `saved-profiles.contract.test.ts` runs it on the in-memory adapter and
 * on the one over the Device document.
 */
export function savedProfilesContract(
	name: string,
	open: () => Promise<SavedProfilesUnderTest>,
) {
	describe(`SavedProfiles contract: ${name}`, () => {
		let under: SavedProfilesUnderTest;
		beforeEach(async () => {
			under = await open();
		});
		afterEach(async () => {
			await under.close();
		});

		test("nothing saved reads as an empty map", () => {
			expect([...under.saved.read()]).toEqual([]);
		});

		test("a write saves a profile under its id, and the next read has it", async () => {
			await under.saved.write("p-1", agent);
			expect(under.saved.read().get("p-1")).toEqual({
				harness: "claude-code",
				model: "sonnet",
				permissionMode: "acceptEdits",
				clis: [],
				connections: [],
				id: "p-1",
				name: "night",
				description: "The night's agent",
				updatedAt: 1000,
			});
		});

		test("a write replaces the profile of the same id", async () => {
			await under.saved.write("p-1", agent);
			await under.saved.write("p-1", { ...agent, name: "day" });
			expect([...under.saved.read().values()].map((p) => p.name)).toEqual([
				"day",
			]);
		});

		test("a removal takes the profile out", async () => {
			await under.saved.write("p-1", agent);
			await under.saved.write("p-2", { ...agent, name: "day" });
			await under.saved.remove("p-1");
			expect([...under.saved.read().keys()]).toEqual(["p-2"]);
		});

		test("an entry this version cannot read is left out, one without a name too", async () => {
			const { name: _name, ...nameless } = agent;
			await under.put("night", nameless);
			await under.put("p-x", { description: null, updatedAt: "soon" });
			await under.put("p-y", {
				...agent,
				settings: { harness: "nobody" },
			});
			expect(under.saved.read().size).toBe(0);
		});
	});
}
