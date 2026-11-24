import { beforeEach, describe, expect, test } from "bun:test";
import { memoryDb } from "../../../../testing/memory-db";
import { drizzleLocalPersonStore } from "./drizzle-local-person-store";

const make = async () => ({
	localPersonStore: drizzleLocalPersonStore(await memoryDb()),
});

describe("LocalPersonStore over drizzle", () => {
	let under: Awaited<ReturnType<typeof make>>;
	beforeEach(async () => {
		under = await make();
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
