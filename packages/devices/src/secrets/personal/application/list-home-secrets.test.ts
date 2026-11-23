import { describe, expect, test } from "bun:test";
import { Refusal } from "@nightshift/refusal";
import type { Caller } from "../../../contract";
import { inMemoryPersonalSecretStore } from "../../kept/adapters/out/in-memory-personal-secret-store";
import { listHomeSecrets } from "./list-home-secrets";

/** A calling Device of Ada: paired here as home, or as a guest. */
const callerOf = (homeHost: string | null) =>
	({
		personId: "person-ada",
		deviceId: "device-a",
		device: { name: "Laptop", homeHost },
	}) as unknown as Caller;

describe("listHomeSecrets", () => {
	test("a Device of the Person, paired here as home, lists its Person's names only", async () => {
		const store = inMemoryPersonalSecretStore(() => 7);
		await store.set("person-ada", "A_TOKEN", "value-a", null);
		await store.set("person-bob", "B_TOKEN", "value-b", null);
		expect(await listHomeSecrets({ store })(callerOf("host.lan"))).toEqual([
			{ name: "A_TOKEN", setAt: 7 },
		]);
	});

	test("refuses a Device that joined as a guest", async () => {
		const store = inMemoryPersonalSecretStore(() => 7);
		await expect(
			listHomeSecrets({ store })(callerOf(null)),
		).rejects.toBeInstanceOf(Refusal);
	});
});
