import { describe, expect, test } from "bun:test";
import type { PersonalSecretStore } from "../../application/ports";

/** One adapter of `PersonalSecretStore` to test, on a clock at `now`. */
export type PersonalSecretStoreUnderTest = {
	personalSecretStore: PersonalSecretStore;
};

/**
 * What every adapter of `PersonalSecretStore` does.
 * `personal-secret-store.contract.test.ts` runs it on the in-memory
 * adapter and on the real one.
 */
export function personalSecretStoreContract(
	name: string,
	make: (now: () => number) => Promise<PersonalSecretStoreUnderTest>,
): void {
	describe(`PersonalSecretStore contract: ${name}`, () => {
		test("lists an owner's names by name, with when each was set", async () => {
			const { personalSecretStore: store } = await make(() => 5_000);
			await store.set("person-ada", "B_TOKEN", "value-b", "device-a");
			await store.set("person-ada", "A_TOKEN", "value-a", null);
			await store.set("person-bob", "C_TOKEN", "value-c", null);
			expect(await store.list("person-ada")).toEqual([
				{ name: "A_TOKEN", setAt: 5_000 },
				{ name: "B_TOKEN", setAt: 5_000 },
			]);
		});

		test("gives the values of the names asked, and the owner's only", async () => {
			const { personalSecretStore: store } = await make(() => 1);
			await store.set("person-ada", "A_TOKEN", "value-a", null);
			await store.set("person-bob", "B_TOKEN", "value-b", null);
			expect(
				await store.values("person-ada", ["A_TOKEN", "B_TOKEN", "A_TOKEN"]),
			).toEqual({ A_TOKEN: "value-a" });
			expect(await store.values("person-ada", [])).toEqual({});
		});

		test("a save replaces the value, and a removal drops it", async () => {
			const { personalSecretStore: store } = await make(() => 1);
			await store.set("person-ada", "A_TOKEN", "value-a", null);
			await store.set("person-ada", "A_TOKEN", "value-new", "device-a");
			expect(await store.values("person-ada", ["A_TOKEN"])).toEqual({
				A_TOKEN: "value-new",
			});
			await store.remove("person-ada", "A_TOKEN");
			expect(await store.list("person-ada")).toEqual([]);
		});
	});
}
