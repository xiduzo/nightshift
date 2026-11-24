import { describe, expect, test } from "bun:test";
import { Refusal } from "@nightshift/refusal";
import type { Caller } from "../../../contract";
import { personalSecrets } from "../test-support";
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
		const { store, rows } = await personalSecrets();
		await saveHomeSecret({ store })(callerOf("host.lan"), {
			name: "A_TOKEN",
			value: "value-a",
		});
		expect(await rows()).toEqual([
			{
				ownerId: "person-ada",
				name: "A_TOKEN",
				value: "value-a",
				setAt: 7,
				setBy: "device-a",
			},
		]);
	});

	test("refuses a Device that joined as a guest", async () => {
		const { store, rows } = await personalSecrets();
		await expect(
			saveHomeSecret({ store })(callerOf(null), {
				name: "A_TOKEN",
				value: "value-a",
			}),
		).rejects.toBeInstanceOf(Refusal);
		expect(await rows()).toEqual([]);
	});
});
