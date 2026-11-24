import { describe, expect, test } from "bun:test";
import { keptGround } from "../../test-support";
import { drizzleProjectSecretStore } from "./drizzle-project-secret-store";

const make = async (now: () => number) => ({
	projectSecretStore: drizzleProjectSecretStore({
		...(await keptGround()),
		now,
	}),
});

describe("ProjectSecretStore over drizzle", () => {
	test("lists the names of one Project by name, with when and by whom", async () => {
		const { projectSecretStore: store } = await make(() => 5_000);
		await store.set(
			{ spaceId: "space-1", projectId: "project-1" },
			"B_TOKEN",
			"value-b",
			"person-ada",
		);
		await store.set(
			{ spaceId: "space-1", projectId: "project-1" },
			"A_TOKEN",
			"value-a",
			"person-bob",
		);
		await store.set(
			{ spaceId: "space-1", projectId: "project-2" },
			"C_TOKEN",
			"value-c",
			"person-ada",
		);
		expect(await store.list("project-1")).toEqual([
			{ name: "A_TOKEN", setAt: 5_000, setBy: "person-bob" },
			{ name: "B_TOKEN", setAt: 5_000, setBy: "person-ada" },
		]);
	});

	test("gives the values of the names asked, or every one without names", async () => {
		const { projectSecretStore: store } = await make(() => 1);
		await store.set(
			{ spaceId: "space-1", projectId: "project-1" },
			"A_TOKEN",
			"value-a",
			"person-ada",
		);
		await store.set(
			{ spaceId: "space-1", projectId: "project-1" },
			"B_TOKEN",
			"value-b",
			"person-ada",
		);
		await store.set(
			{ spaceId: "space-1", projectId: "project-2" },
			"C_TOKEN",
			"value-c",
			"person-ada",
		);
		expect(await store.values("project-1", ["A_TOKEN", "C_TOKEN"])).toEqual({
			A_TOKEN: "value-a",
		});
		expect(await store.values("project-1")).toEqual({
			A_TOKEN: "value-a",
			B_TOKEN: "value-b",
		});
		expect(await store.values("project-1", [])).toEqual({});
	});

	test("a save replaces the value, and a removal drops it", async () => {
		const { projectSecretStore: store } = await make(() => 1);
		await store.set(
			{ spaceId: "space-1", projectId: "project-1" },
			"A_TOKEN",
			"value-a",
			"person-ada",
		);
		await store.set(
			{ spaceId: "space-1", projectId: "project-1" },
			"A_TOKEN",
			"value-new",
			"person-bob",
		);
		expect(await store.values("project-1", ["A_TOKEN"])).toEqual({
			A_TOKEN: "value-new",
		});
		await store.remove("project-1", "A_TOKEN");
		expect(await store.list("project-1")).toEqual([]);
	});
});
