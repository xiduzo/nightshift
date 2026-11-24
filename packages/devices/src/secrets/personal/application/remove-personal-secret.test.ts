import { describe, expect, test } from "bun:test";
import { personalPorts } from "../test-support";
import { removePersonalSecret } from "./remove-personal-secret";

describe("removePersonalSecret", () => {
	test("without a Home Host, this computer removes its owner's value itself", async () => {
		const p = await personalPorts();
		await p.store.set("person-ada", "A_TOKEN", "value-a", null);
		await removePersonalSecret(p)({ name: "A_TOKEN" });
		expect(await p.store.list("person-ada")).toEqual([]);
	});

	test("with a Home Host, the removal goes there", async () => {
		const p = await personalPorts();
		await p.store.set("person-ada", "A_TOKEN", "value-a", null);
		p.calls.setHome({ hostId: "host-1", personId: "person-ada" });
		const removed: unknown[] = [];
		p.calls.addHost("host-1", {
			secrets: { remove: async (input: unknown) => void removed.push(input) },
		});
		await removePersonalSecret(p)({ name: "A_TOKEN" });
		expect(removed).toEqual([{ name: "A_TOKEN" }]);
		expect(await p.store.list("person-ada")).toHaveLength(1);
	});
});
