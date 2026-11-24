import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { SavedSettings } from "../../application/ports";

/** One store to test: what an adapter of `SavedSettings` gives the suite. */
export type SavedSettingsUnderTest = {
	saved: SavedSettings;
	close(): Promise<void>;
};

/**
 * What every adapter of `SavedSettings` does.
 * `saved-settings.contract.test.ts` runs it on the in-memory adapter and
 * on the one over the Device document.
 */
export function savedSettingsContract(
	name: string,
	open: () => Promise<SavedSettingsUnderTest>,
) {
	describe(`SavedSettings contract: ${name}`, () => {
		let under: SavedSettingsUnderTest;
		beforeEach(async () => {
			under = await open();
		});
		afterEach(async () => {
			await under.close();
		});

		test("nothing saved reads as an empty map", () => {
			expect([...under.saved.read()]).toEqual([]);
		});

		test("a write saves values and the next read has them", async () => {
			await under.saved.write({
				set: [
					["maxConcurrentRuns", 4],
					["agentModel", "opus"],
				],
				forget: [],
			});
			const read = under.saved.read();
			expect(read.get("maxConcurrentRuns")).toBe(4);
			expect(read.get("agentModel")).toBe("opus");
			expect(read.size).toBe(2);
		});

		test("a second write of a key replaces its value", async () => {
			await under.saved.write({
				set: [["networkGraceMinutes", 30]],
				forget: [],
			});
			await under.saved.write({
				set: [["networkGraceMinutes", 45]],
				forget: [],
			});
			expect([...under.saved.read()]).toEqual([["networkGraceMinutes", 45]]);
		});

		test("a write forgets values and keeps the others", async () => {
			await under.saved.write({
				set: [
					["maxConcurrentRuns", 4],
					["agentModel", "opus"],
				],
				forget: [],
			});
			await under.saved.write({ set: [], forget: ["maxConcurrentRuns"] });
			expect([...under.saved.read()]).toEqual([["agentModel", "opus"]]);
		});

		test("the same key twice in one write keeps the last value", async () => {
			await under.saved.write({
				set: [
					["usageSeen", false],
					["usage", true],
					["usageSeen", true],
				],
				forget: [],
			});
			expect(under.saved.read().get("usageSeen")).toBe(true);
		});

		test("a listener hears each write until it unsubscribes", async () => {
			let heard = 0;
			const stop = under.saved.onChange(() => {
				heard += 1;
			});
			await under.saved.write({
				set: [["networkGraceMinutes", 30]],
				forget: [],
			});
			expect(heard).toBe(1);
			stop();
			await under.saved.write({
				set: [["networkGraceMinutes", 45]],
				forget: [],
			});
			expect(heard).toBe(1);
			expect(under.saved.read().get("networkGraceMinutes")).toBe(45);
		});
	});
}
