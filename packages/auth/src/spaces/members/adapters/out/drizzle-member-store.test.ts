import { beforeEach, describe, expect, test } from "bun:test";
import { memoryDb } from "../../../../testing/memory-db";
import { drizzleMembersSeed } from "../../test-support";
import { drizzleMemberStore } from "./drizzle-member-store";

const make = async () => {
	const db = await memoryDb();
	return {
		memberStore: drizzleMemberStore(db),
		seed: drizzleMembersSeed(db),
	};
};

describe("MemberStore over drizzle", () => {
	let under: Awaited<ReturnType<typeof make>>;
	beforeEach(async () => {
		under = await make();
		await under.seed.person({ id: "ada", name: "Ada", email: "a@x.org" });
		await under.seed.person({ id: "bo", name: "Bo", email: "b@x.org" });
		await under.seed.space({ id: "platform", name: "Platform" });
		await under.seed.space({ id: "other", name: "Other" });
	});

	test("a Space without memberships has no Members", async () => {
		expect(await under.memberStore.membersOf("platform")).toEqual([]);
		expect(await under.memberStore.roster("platform")).toEqual([]);
		expect(await under.memberStore.membershipOf("platform", "ada")).toBeNull();
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

	test("a membership is of its Person: another Member's is not read", async () => {
		await under.seed.membership({
			id: "m-ada",
			spaceId: "platform",
			personId: "ada",
			role: "owner",
			createdAt: 1,
		});
		expect(await under.memberStore.membershipOf("platform", "bo")).toBeNull();
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
