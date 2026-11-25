import { describe, expect, spyOn, test } from "bun:test";
import { keptGround } from "../../test-support";
import { drizzlePersonalSecretStore } from "./drizzle-personal-secret-store";

const make = async (now: () => number) => ({
	personalSecretStore: drizzlePersonalSecretStore({
		...(await keptGround()),
		now,
	}),
});

describe("PersonalSecretStore over drizzle", () => {
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
		await store.set("person-ada", "C_TOKEN", "value-c", null);
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

	test("a removal drops one name of one Person only, and a read takes no row of another Person", async () => {
		const warned = spyOn(console, "warn").mockImplementation(() => {});
		const { personalSecretStore: store } = await make(() => 1);
		await store.set("person-1", "A_TOKEN", "value-a", null);
		await store.set("person-1", "B_TOKEN", "value-b", null);
		await store.set("person-2", "A_TOKEN", "value-other", null);
		await store.remove("person-1", "A_TOKEN");
		expect(await store.values("person-1", ["A_TOKEN", "B_TOKEN"])).toEqual({
			B_TOKEN: "value-b",
		});
		expect(await store.values("person-2", ["A_TOKEN"])).toEqual({
			A_TOKEN: "value-other",
		});
		expect(warned).not.toHaveBeenCalled();
		warned.mockRestore();
	});
});
