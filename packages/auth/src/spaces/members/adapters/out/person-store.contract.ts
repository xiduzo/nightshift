import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { PersonStore } from "../../application/ports";
import type { MembersSeed } from "./in-memory-person-store";

/** One adapter of `PersonStore` to test, with what puts rows before it. */
export type PersonStoreUnderTest = {
	personStore: PersonStore;
	seed: MembersSeed;
	close(): Promise<void>;
};

/**
 * What every adapter of `PersonStore` does.
 * `person-store.contract.test.ts` runs it on the in-memory adapter and
 * on the real one.
 */
export function personStoreContract(
	name: string,
	make: () => Promise<PersonStoreUnderTest>,
): void {
	describe(`PersonStore contract: ${name}`, () => {
		let under: PersonStoreUnderTest;
		beforeEach(async () => {
			under = await make();
		});
		afterEach(async () => {
			await under.close();
		});

		test("a Replica without Persons has nobody and no admin", async () => {
			expect(await under.personStore.hasAnyone()).toBe(false);
			expect(await under.personStore.hasRole("admin")).toBe(false);
			expect(await under.personStore.roleOf("ada")).toBeNull();
			expect(await under.personStore.contact("ada")).toBeNull();
		});

		test("reads and gives the admin plugin's role", async () => {
			await under.seed.person({ id: "ada", name: "Ada", email: "a@x.org" });
			await under.seed.person({
				id: "bo",
				name: "Bo",
				email: "b@x.org",
				role: "user",
			});
			expect(await under.personStore.hasAnyone()).toBe(true);
			expect(await under.personStore.roleOf("ada")).toBeNull();
			expect(await under.personStore.roleOf("bo")).toBe("user");
			expect(await under.personStore.hasRole("admin")).toBe(false);
			await under.personStore.setRole("ada", "admin");
			expect(await under.personStore.hasRole("admin")).toBe(true);
			expect(await under.personStore.roleOf("ada")).toBe("admin");
		});

		test("finds an account by its email in any case", async () => {
			await under.seed.person({ id: "ada", name: "Ada", email: "Ada@X.org" });
			expect(await under.personStore.hasAccount("ada@x.org")).toBe(true);
			expect(await under.personStore.hasAccount("bo@x.org")).toBe(false);
		});

		test("names and contacts the Persons it knows", async () => {
			await under.seed.person({ id: "ada", name: "Ada", email: "a@x.org" });
			await under.seed.person({ id: "bo", name: "Bo", email: "b@x.org" });
			expect(await under.personStore.names(["ada", "cy"])).toEqual(
				new Map([["ada", "Ada"]]),
			);
			expect(await under.personStore.contact("bo")).toEqual({
				name: "Bo",
				email: "b@x.org",
			});
		});
	});
}
