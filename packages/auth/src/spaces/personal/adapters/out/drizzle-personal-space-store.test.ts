import { beforeEach, describe, expect, test } from "bun:test";
import { memoryDb } from "../../../../testing/memory-db";
import type { PersonalSpaceStore } from "../../application/ports";
import type { RowBatch } from "../../domain/personal-space";
import { drizzlePersonalSeed, runBatch } from "../../test-support";
import { drizzlePersonalSpaceStore } from "./drizzle-personal-space-store";

async function make() {
	const db = await memoryDb();
	return {
		personalSpaceStore: drizzlePersonalSpaceStore(db),
		seed: drizzlePersonalSeed(db),
		run: (rows: RowBatch) => runBatch(db, rows),
	};
}

describe("PersonalSpaceStore over drizzle", () => {
	let under: Awaited<ReturnType<typeof make>>;
	let store: PersonalSpaceStore;
	const ADA = "ada";
	const personal = {
		id: "mine",
		name: "Personal",
		slug: "personal-ada",
		personId: ADA,
		membershipId: "m-mine",
	};
	beforeEach(async () => {
		under = await make();
		store = under.personalSpaceStore;
		await under.seed.person({ id: ADA, name: "Ada", email: "a@x.org" });
	});

	test("knows no Space and no membership before one is made", async () => {
		expect(await store.personalSpaceId(ADA)).toBeNull();
		expect(await store.spaceIdBySlug("personal-ada")).toBeNull();
		expect(await store.exists("mine")).toBe(false);
		expect(await store.membershipId("mine", ADA)).toBeNull();
	});

	test("makes a personal Space with its owner", async () => {
		await store.create(personal);
		expect(await store.personalSpaceId(ADA)).toBe("mine");
		expect(await store.spaceIdBySlug("personal-ada")).toBe("mine");
		expect(await store.exists("mine")).toBe(true);
		expect(await store.membershipId("mine", ADA)).toBe("m-mine");
	});

	test("makes nothing for a Person this Replica does not know", async () => {
		const made = store.create({ ...personal, personId: "nobody" });
		expect(await made.then(() => true).catch(() => false)).toBe(false);
		expect(await store.exists("mine")).toBe(false);
	});

	test("a Space that is not personal is not the Person's personal Space", async () => {
		await under.seed.space({
			id: "shared",
			name: "Shared",
			slug: "shared",
			personal: false,
		});
		await under.seed.membership({
			id: "m-shared",
			spaceId: "shared",
			personId: ADA,
			role: "owner",
		});
		expect(await store.personalSpaceId(ADA)).toBeNull();
		expect(await store.membershipId("shared", ADA)).toBe("m-shared");
	});

	for (const member of [true, false]) {
		test(`adopting makes the Host's Space the personal one${member ? "" : ", also without a membership of it"}`, async () => {
			await store.create(personal);
			await under.seed.space({
				id: "host",
				name: "Ada's",
				slug: "host-host",
				personal: false,
			});
			if (member) {
				await under.seed.membership({
					id: "m-host",
					spaceId: "host",
					personId: ADA,
					role: "viewer",
				});
			}
			await under.run(
				store.adoptRows({
					personId: ADA,
					from: "mine",
					to: "host",
					name: "Personal",
					membershipId: member ? "m-host" : null,
					newMembershipId: "m-new",
				}),
			);
			expect(await store.personalSpaceId(ADA)).toBe("host");
			expect(await store.exists("mine")).toBe(false);
			expect(await store.membershipId("host", ADA)).toBe(
				member ? "m-host" : "m-new",
			);
			expect(await store.membershipId("mine", ADA)).toBeNull();
		});
	}

	test("splitting gives the Person a new personal Space, and the Host's stays without her", async () => {
		await store.create(personal);
		await under.run(
			store.splitRows({
				personId: ADA,
				from: "mine",
				to: "new",
				name: "Personal",
				slug: "personal-ada-new",
				membershipId: "m-new",
				fromName: "Personal on Host",
			}),
		);
		expect(await store.personalSpaceId(ADA)).toBe("new");
		expect(await store.spaceIdBySlug("personal-ada-new")).toBe("new");
		expect(await store.exists("mine")).toBe(true);
		expect(await store.membershipId("mine", ADA)).toBeNull();
		expect(await store.membershipId("new", ADA)).toBe("m-new");
	});
});
