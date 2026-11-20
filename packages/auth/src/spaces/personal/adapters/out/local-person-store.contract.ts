import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { LocalPersonStore } from "../../application/ports";

/** One adapter of `LocalPersonStore` to test. */
export type LocalPersonStoreUnderTest = {
	localPersonStore: LocalPersonStore;
	close(): Promise<void>;
};

/**
 * What every adapter of `LocalPersonStore` does.
 * `local-person-store.contract.test.ts` runs it on the in-memory adapter
 * and on the real one.
 */
export function localPersonStoreContract(
	name: string,
	make: () => Promise<LocalPersonStoreUnderTest>,
): void {
	describe(`LocalPersonStore contract: ${name}`, () => {
		let under: LocalPersonStoreUnderTest;
		beforeEach(async () => {
			under = await make();
		});
		afterEach(async () => {
			await under.close();
		});

		test("an unknown id or email is null", async () => {
			expect(await under.localPersonStore.find("nobody-has-it")).toBeNull();
			expect(await under.localPersonStore.findByEmail("a@x.org")).toBeNull();
		});

		test("adds a Person, finds them by id and email, and renames them", async () => {
			const store = under.localPersonStore;
			await store.add({ id: "ada", name: "", email: "a@x.org", role: "user" });
			expect(await store.find("ada")).toMatchObject({ id: "ada", name: "" });
			expect(await store.findByEmail("a@x.org")).toMatchObject({ id: "ada" });
			expect(await store.findByEmail("A@x.org")).toBeNull();
			await store.rename("ada", "Ada");
			expect(await store.find("ada")).toMatchObject({ id: "ada", name: "Ada" });
		});
	});
}
