import { describe, expect, test } from "bun:test";
import { personalPorts } from "../test-support";
import { savePersonalSecret } from "./save-personal-secret";

describe("savePersonalSecret", () => {
	test("without a Home Host, this computer keeps its owner's value, set by its own Device", async () => {
		const p = await personalPorts();
		await savePersonalSecret(p)({ name: "A_TOKEN", value: "value-a" });
		expect(await p.rows()).toEqual([
			{
				ownerId: "person-ada",
				name: "A_TOKEN",
				value: "value-a",
				setAt: 7,
				setBy: "device-self",
			},
		]);
	});

	test("with a Home Host, the value goes there; nothing is kept here", async () => {
		const p = await personalPorts();
		p.calls.setHome({ hostId: "host-1", personId: "person-ada" });
		const saved: unknown[] = [];
		p.calls.addHost("host-1", {
			secrets: { set: async (input: unknown) => void saved.push(input) },
		});
		await savePersonalSecret(p)({ name: "A_TOKEN", value: "value-a" });
		expect(saved).toEqual([{ name: "A_TOKEN", value: "value-a" }]);
		expect(await p.rows()).toEqual([]);
	});

	test("a Home Host without a link cannot be reached", async () => {
		const p = await personalPorts();
		p.calls.setHome({ hostId: "host-1", personId: "person-ada" });
		await expect(
			savePersonalSecret(p)({ name: "A_TOKEN", value: "value-a" }),
		).rejects.toHaveProperty("name", "HostUnreachableError");
		expect(await p.rows()).toEqual([]);
	});
});
