import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { SpaceStore } from "../../application/ports";

/** One adapter of `SpaceStore` to test, with what puts rows before it. */
export type SpaceStoreUnderTest = {
	spaceStore: SpaceStore;
	seed: {
		person(id: string): Promise<void>;
		space(space: {
			id: string;
			name: string;
			personal: boolean;
		}): Promise<void>;
		membership(row: {
			spaceId: string;
			personId: string;
			role: string;
		}): Promise<void>;
		/** A membership whose Space is gone. */
		orphanMembership(row: {
			spaceId: string;
			personId: string;
			role: string;
		}): Promise<void>;
	};
	close(): Promise<void>;
};

/**
 * What every adapter of `SpaceStore` does.
 * `space-store.contract.test.ts` runs it on the in-memory adapter and on
 * the real one.
 */
export function spaceStoreContract(
	name: string,
	make: () => Promise<SpaceStoreUnderTest>,
): void {
	describe(`SpaceStore contract: ${name}`, () => {
		let under: SpaceStoreUnderTest;
		let store: SpaceStore;
		beforeEach(async () => {
			under = await make();
			store = under.spaceStore;
			await under.seed.person("ada");
		});
		afterEach(async () => {
			await under.close();
		});

		test("a Replica without Spaces", async () => {
			expect(await store.spacesOf("ada")).toEqual([]);
			expect(await store.roleOf("ada", "platform")).toBeNull();
			expect(await store.exists("platform")).toBe(false);
			expect(await store.ids()).toEqual([]);
		});

		test("lists the Person's Spaces, the personal one first, then by name", async () => {
			for (const [id, spaceName, personal] of [
				["b", "Beta", false],
				["p", "Personal", true],
				["a", "Alpha", false],
				["c", "Not hers", false],
			] as const) {
				await under.seed.space({ id, name: spaceName, personal });
			}
			for (const [spaceId, role] of [
				["b", "viewer"],
				["p", "owner"],
				["a", "member"],
			] as const) {
				await under.seed.membership({ spaceId, personId: "ada", role });
			}
			expect(await store.spacesOf("ada")).toEqual([
				{ id: "p", name: "Personal", personal: true, role: "owner" },
				{ id: "a", name: "Alpha", personal: false, role: "member" },
				{ id: "b", name: "Beta", personal: false, role: "viewer" },
			]);
			expect(await store.roleOf("ada", "b")).toBe("viewer");
			expect(await store.roleOf("ada", "c")).toBeNull();
			expect(await store.exists("c")).toBe(true);
			expect((await store.ids()).sort()).toEqual(["a", "b", "c", "p"]);
		});

		test("a membership of a Space that is gone counts for the role, not for the list", async () => {
			await under.seed.orphanMembership({
				spaceId: "gone",
				personId: "ada",
				role: "admin",
			});
			expect(await store.roleOf("ada", "gone")).toBe("admin");
			expect(await store.spacesOf("ada")).toEqual([]);
			expect(await store.exists("gone")).toBe(false);
		});

		test("mirrors a Host's Space: makes it, then gives it the Host's name", async () => {
			await store.mirror({ id: "host", name: "Platform" });
			expect(await store.exists("host")).toBe(true);
			await store.mirror({ id: "host", name: "Platform 2" });
			await under.seed.membership({
				spaceId: "host",
				personId: "ada",
				role: "member",
			});
			expect(await store.spacesOf("ada")).toEqual([
				{ id: "host", name: "Platform 2", personal: false, role: "member" },
			]);
		});
	});
}
