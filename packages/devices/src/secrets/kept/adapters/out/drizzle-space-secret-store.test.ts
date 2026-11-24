import { describe, expect, spyOn, test } from "bun:test";
import { keptGround } from "../../test-support";
import { drizzleSpaceSecretStore } from "./drizzle-space-secret-store";

const make = async (now: () => number) => ({
	spaceSecretStore: drizzleSpaceSecretStore({ ...(await keptGround()), now }),
});

describe("SpaceSecretStore over drizzle", () => {
	test("lists the names of one Space by name, with when and by whom", async () => {
		const { spaceSecretStore: store } = await make(() => 5_000);
		await store.set("space-1", "B_TOKEN", "value-b", "person-ada");
		await store.set("space-1", "A_TOKEN", "value-a", "person-bob");
		await store.set("space-2", "C_TOKEN", "value-c", "person-ada");
		expect(await store.list("space-1")).toEqual([
			{ name: "A_TOKEN", setAt: 5_000, setBy: "person-bob" },
			{ name: "B_TOKEN", setAt: 5_000, setBy: "person-ada" },
		]);
	});

	test("gives the values of the names asked, or every one without names", async () => {
		const { spaceSecretStore: store } = await make(() => 1);
		await store.set("space-1", "A_TOKEN", "value-a", "person-ada");
		await store.set("space-1", "B_TOKEN", "value-b", "person-ada");
		await store.set("space-2", "C_TOKEN", "value-c", "person-ada");
		expect(await store.values("space-1", ["A_TOKEN", "C_TOKEN"])).toEqual({
			A_TOKEN: "value-a",
		});
		expect(await store.values("space-1")).toEqual({
			A_TOKEN: "value-a",
			B_TOKEN: "value-b",
		});
		expect(await store.values("space-1", [])).toEqual({});
	});

	test("a save replaces the value, and a removal drops it", async () => {
		const { spaceSecretStore: store } = await make(() => 1);
		await store.set("space-1", "A_TOKEN", "value-a", "person-ada");
		await store.set("space-1", "A_TOKEN", "value-new", "person-bob");
		expect(await store.values("space-1", ["A_TOKEN"])).toEqual({
			A_TOKEN: "value-new",
		});
		await store.remove("space-1", "A_TOKEN");
		expect(await store.list("space-1")).toEqual([]);
	});

	test("a removal drops one name of one Space only, and a read takes no row of another Space", async () => {
		const warned = spyOn(console, "warn").mockImplementation(() => {});
		const { spaceSecretStore: store } = await make(() => 1);
		await store.set("space-1", "A_TOKEN", "value-a", "person-ada");
		await store.set("space-1", "B_TOKEN", "value-b", "person-ada");
		await store.set("space-2", "A_TOKEN", "value-other", "person-ada");
		await store.remove("space-1", "A_TOKEN");
		expect(await store.values("space-1", ["A_TOKEN", "B_TOKEN"])).toEqual({
			B_TOKEN: "value-b",
		});
		expect(await store.values("space-2", ["A_TOKEN"])).toEqual({
			A_TOKEN: "value-other",
		});
		expect(warned).not.toHaveBeenCalled();
		warned.mockRestore();
	});
});
