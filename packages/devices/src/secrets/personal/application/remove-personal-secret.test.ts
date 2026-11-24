import { describe, expect, test } from "bun:test";
import { inMemoryHostCalls } from "../../calls/adapters/out/in-memory-host-calls";
import { inMemoryPersonalSecretStore } from "../../kept/adapters/out/in-memory-personal-secret-store";
import { removePersonalSecret } from "./remove-personal-secret";

/** The ports of a computer of Ada, without a Home Host until a test gives one. */
function portsOf() {
	return {
		store: inMemoryPersonalSecretStore(() => 7),
		calls: inMemoryHostCalls(),
		ownerId: "person-ada",
		selfId: "device-self",
		deadlineMs: 20_000,
	};
}

describe("removePersonalSecret", () => {
	test("without a Home Host, this computer removes its owner's value itself", async () => {
		const p = portsOf();
		await p.store.set("person-ada", "A_TOKEN", "value-a", null);
		await removePersonalSecret(p)({ name: "A_TOKEN" });
		expect(await p.store.list("person-ada")).toEqual([]);
	});

	test("with a Home Host, the removal goes there", async () => {
		const p = portsOf();
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
