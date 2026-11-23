import { describe, expect, test } from "bun:test";
import { Refusal } from "@nightshift/refusal";
import type { Caller } from "../../../contract";
import { inMemoryPersonalSecretStore } from "../../kept/adapters/out/in-memory-personal-secret-store";
import { saveHomeSecret } from "./save-home-secret";

/** A calling Device of Ada: paired here as home, or as a guest. */
const callerOf = (homeHost: string | null) =>
	({
		personId: "person-ada",
		deviceId: "device-a",
		device: { name: "Laptop", homeHost },
	}) as unknown as Caller;

describe("saveHomeSecret", () => {
	test("a Device of the Person, paired here as home, sets its Person's value", async () => {
		const store = inMemoryPersonalSecretStore(() => 7);
		await saveHomeSecret({ store })(callerOf("host.lan"), {
			name: "A_TOKEN",
			value: "value-a",
		});
		expect(store.rows.get("person-ada")?.get("A_TOKEN")).toEqual({
			value: "value-a",
			setAt: 7,
			setBy: "device-a",
		});
	});

	test("refuses a Device that joined as a guest", async () => {
		const store = inMemoryPersonalSecretStore(() => 7);
		await expect(
			saveHomeSecret({ store })(callerOf(null), {
				name: "A_TOKEN",
				value: "value-a",
			}),
		).rejects.toBeInstanceOf(Refusal);
		expect(store.rows.size).toBe(0);
	});
});
