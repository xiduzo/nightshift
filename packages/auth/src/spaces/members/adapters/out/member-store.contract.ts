import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { MemberStore } from "../../application/ports";
import type { MembersSeed } from "./in-memory-person-store";

/** One adapter of `MemberStore` to test, with what puts rows before it. */
export type MemberStoreUnderTest = {
	memberStore: MemberStore;
	seed: MembersSeed;
	close(): Promise<void>;
};

/**
 * What every adapter of `MemberStore` does.
 * `member-store.contract.test.ts` runs it on the in-memory adapter and
 * on the real one.
 */
export function memberStoreContract(
	name: string,
	make: () => Promise<MemberStoreUnderTest>,
): void {
	describe(`MemberStore contract: ${name}`, () => {
		let under: MemberStoreUnderTest;
		beforeEach(async () => {
			under = await make();
			await under.seed.person({ id: "ada", name: "Ada", email: "a@x.org" });
			await under.seed.person({ id: "bo", name: "Bo", email: "b@x.org" });
			await under.seed.space({ id: "platform", name: "Platform" });
			await under.seed.space({ id: "other", name: "Other" });
		});
		afterEach(async () => {
			await under.close();
		});

		test("a Space without memberships has no Members", async () => {
			expect(await under.memberStore.membersOf("platform")).toEqual([]);
			expect(await under.memberStore.roster("platform")).toEqual([]);
			expect(
				await under.memberStore.membershipOf("platform", "ada"),
			).toBeNull();
		});

		test("lists the Members of a Space oldest first, with their names", async () => {
			await under.seed.membership({
				id: "m-bo",
				spaceId: "platform",
				personId: "bo",
				role: "viewer",
				createdAt: 20,
			});
			await under.seed.membership({
				id: "m-ada",
				spaceId: "platform",
				personId: "ada",
				role: "owner",
				createdAt: 10,
			});
			await under.seed.membership({
				id: "m-other",
				spaceId: "other",
				personId: "ada",
				role: "member",
				createdAt: 5,
			});
			expect(await under.memberStore.membersOf("platform")).toEqual([
				{
					id: "m-ada",
					personId: "ada",
					name: "Ada",
					email: "a@x.org",
					role: "owner",
					joinedAt: 10,
				},
				{
					id: "m-bo",
					personId: "bo",
					name: "Bo",
					email: "b@x.org",
					role: "viewer",
					joinedAt: 20,
				},
			]);
			const roster = await under.memberStore.roster("platform");
			expect(roster.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
				{ id: "ada", name: "Ada", role: "owner" },
				{ id: "bo", name: "Bo", role: "viewer" },
			]);
		});

		test("adds a membership, gives it a role, removes it", async () => {
			await under.memberStore.add({
				id: "m-1",
				spaceId: "platform",
				personId: "bo",
				role: "member",
			});
			await under.memberStore.add({
				id: "m-2",
				spaceId: "other",
				personId: "bo",
				role: "member",
			});
			expect(await under.memberStore.membershipOf("platform", "bo")).toEqual({
				id: "m-1",
				role: "member",
			});
			await under.memberStore.setRole("m-1", "admin");
			expect(await under.memberStore.membershipOf("platform", "bo")).toEqual({
				id: "m-1",
				role: "admin",
			});
			await under.memberStore.remove(["platform", "nowhere"], "bo");
			expect(await under.memberStore.membershipOf("platform", "bo")).toBeNull();
			expect(await under.memberStore.membershipOf("other", "bo")).toEqual({
				id: "m-2",
				role: "member",
			});
		});
	});
}
