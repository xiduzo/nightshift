import { describe, expect, test } from "bun:test";
import type { Caller } from "../../../contract";
import { inMemoryPersonalSecretStore } from "../../kept/adapters/out/in-memory-personal-secret-store";
import { readHomeSecretValues } from "./read-home-secret-values";

/** A calling Device of Ada: paired here as home, or as a guest. */
const callerOf = (homeHost: string | null) =>
	({
		personId: "person-ada",
		deviceId: "device-a",
		device: { name: "Laptop", homeHost },
	}) as unknown as Caller;

describe("readHomeSecretValues", () => {
	test("another Person's Device never gets them: it reads its own Person's only", async () => {
		const store = inMemoryPersonalSecretStore(() => 7);
		await store.set("person-ada", "A_TOKEN", "value-a", null);
		await store.set("person-bob", "B_TOKEN", "value-b", null);
		expect(
			await readHomeSecretValues({ store })(callerOf("host.lan"), {
				names: ["A_TOKEN", "B_TOKEN"],
			}),
		).toEqual({ A_TOKEN: "value-a" });
	});

	test("refuses a Device that joined as a guest: its Personal secrets stay with its home Host", async () => {
		const store = inMemoryPersonalSecretStore(() => 7);
		await store.set("person-ada", "A_TOKEN", "value-a", null);
		await expect(
			readHomeSecretValues({ store })(callerOf(null), { names: ["A_TOKEN"] }),
		).rejects.toThrow(
			"This computer keeps no Personal secrets for you. They stay with your home Host.",
		);
	});
});
