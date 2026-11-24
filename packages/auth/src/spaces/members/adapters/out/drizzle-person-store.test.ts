import { beforeEach, describe, expect, test } from "bun:test";
import { memoryDb } from "../../../../testing/memory-db";
import { drizzleMembersSeed } from "../../test-support";
import { drizzlePersonStore } from "./drizzle-person-store";

const make = async () => {
	const db = await memoryDb();
	return {
		personStore: drizzlePersonStore(db),
		seed: drizzleMembersSeed(db),
	};
};

describe("PersonStore over drizzle", () => {
	let under: Awaited<ReturnType<typeof make>>;
	beforeEach(async () => {
		under = await make();
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
