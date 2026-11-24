import { describe, expect, test } from "bun:test";
import { inMemoryHostCalls } from "../../calls/adapters/out/in-memory-host-calls";
import { inMemoryPersonalSecretStore } from "../../kept/adapters/out/in-memory-personal-secret-store";
import { listPersonalSecrets } from "./list-personal-secrets";

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

describe("listPersonalSecrets", () => {
	test("without a Home Host, this computer lists its owner's names itself", async () => {
		const p = portsOf();
		await p.store.set("person-ada", "A_TOKEN", "value-a", null);
		expect(await listPersonalSecrets(p)()).toEqual([
			{ name: "A_TOKEN", setAt: 7 },
		]);
		expect(p.calls.asked).toEqual([]);
	});

	test("with a Home Host, the call goes there", async () => {
		const p = portsOf();
		p.calls.setHome({ hostId: "host-1", personId: "person-ada" });
		p.calls.addHost("host-1", {
			secrets: { list: async () => [{ name: "B_TOKEN", setAt: 3 }] },
		});
		expect(await listPersonalSecrets(p)()).toEqual([
			{ name: "B_TOKEN", setAt: 3 },
		]);
		expect(p.calls.asked).toEqual([{ hostId: "host-1", deadlineMs: 20_000 }]);
	});

	test("a Home Host without a link cannot be reached", async () => {
		const p = portsOf();
		p.calls.setHome({ hostId: "host-1", personId: "person-ada" });
		await expect(listPersonalSecrets(p)()).rejects.toHaveProperty(
			"name",
			"HostUnreachableError",
		);
	});
});
