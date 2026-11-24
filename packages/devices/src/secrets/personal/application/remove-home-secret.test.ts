import { describe, expect, test } from "bun:test";
import { Refusal } from "@nightshift/refusal";
import type { Caller } from "../../../contract";
import { personalSecrets } from "../test-support";
import { removeHomeSecret } from "./remove-home-secret";

/** A calling Device of Ada: paired here as home, or as a guest. */
const callerOf = (homeHost: string | null) =>
	({
		personId: "person-ada",
		deviceId: "device-a",
		device: { name: "Laptop", homeHost },
	}) as unknown as Caller;

describe("removeHomeSecret", () => {
	test("a Device of the Person, paired here as home, removes its Person's value", async () => {
		const { store } = await personalSecrets();
		await store.set("person-ada", "A_TOKEN", "value-a", null);
		await removeHomeSecret({ store })(callerOf("host.lan"), {
			name: "A_TOKEN",
		});
		expect(await store.list("person-ada")).toEqual([]);
	});

	test("refuses a Device that joined as a guest", async () => {
		const { store } = await personalSecrets();
		await store.set("person-ada", "A_TOKEN", "value-a", null);
		await expect(
			removeHomeSecret({ store })(callerOf(null), { name: "A_TOKEN" }),
		).rejects.toBeInstanceOf(Refusal);
		expect(await store.list("person-ada")).toHaveLength(1);
	});
});
