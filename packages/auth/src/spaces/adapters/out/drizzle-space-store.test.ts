import { beforeEach, describe, expect, test } from "bun:test";
import { member, organization, user } from "@nightshift/db/schema";
import { asDate } from "@nightshift/time";
import { eq, sql } from "drizzle-orm";
import { memoryDb } from "../../../testing/memory-db";
import type { SpaceStore } from "../../application/ports";
import { drizzleSpaceStore } from "./drizzle-space-store";

const make = async () => {
	const db = await memoryDb();
	let memberships = 0;
	const membership = async (row: {
		spaceId: string;
		personId: string;
		role: string;
	}) => {
		await db.insert(member).values({
			id: `m-${++memberships}`,
			organizationId: row.spaceId,
			userId: row.personId,
			role: row.role,
			createdAt: asDate(0),
		});
	};
	return {
		spaceStore: drizzleSpaceStore(db),
		/** The slug of the Space of that id. */
		slugOf: async (id: string) =>
			(
				await db
					.select({ slug: organization.slug })
					.from(organization)
					.where(eq(organization.id, id))
			)[0]?.slug,
		seed: {
			person: async (id: string) => {
				await db.insert(user).values({ id, name: id, email: `${id}@x.org` });
			},
			space: async (space: { id: string; name: string; personal: boolean }) => {
				await db
					.insert(organization)
					.values({ ...space, slug: space.id, createdAt: asDate(0) });
			},
			membership,
			/** A membership whose Space is gone. */
			orphanMembership: async (row: Parameters<typeof membership>[0]) => {
				await db.run(sql`PRAGMA foreign_keys = OFF`);
				await membership(row);
				await db.run(sql`PRAGMA foreign_keys = ON`);
			},
		},
	};
};

describe("SpaceStore over drizzle", () => {
	let under: Awaited<ReturnType<typeof make>>;
	let store: SpaceStore;
	beforeEach(async () => {
		under = await make();
		store = under.spaceStore;
		await under.seed.person("ada");
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
		expect(await store.roleOf("someone-else", "b")).toBeNull();
		expect(await store.exists("c")).toBe(true);
		expect(await store.exists("gone")).toBe(false);
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
		expect(await under.slugOf("host")).toBe("host-host");
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
