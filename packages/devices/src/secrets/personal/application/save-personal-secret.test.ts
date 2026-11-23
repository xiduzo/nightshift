import { describe, expect, test } from "bun:test";
import { inMemoryHostCalls } from "../../calls/adapters/out/in-memory-host-calls";
import { inMemoryPersonalSecretStore } from "../../kept/adapters/out/in-memory-personal-secret-store";
import { savePersonalSecret } from "./save-personal-secret";

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

const OLDER =
	"Your home Host runs an older version of Night Shift. Update Night Shift there to use Personal secrets.";

describe("savePersonalSecret", () => {
	test("without a Home Host, this computer keeps its owner's value, set by its own Device", async () => {
		const p = portsOf();
		await savePersonalSecret(p)({ name: "A_TOKEN", value: "value-a" });
		expect(p.store.rows.get("person-ada")?.get("A_TOKEN")).toEqual({
			value: "value-a",
			setAt: 7,
			setBy: "device-self",
		});
	});

	test("with a Home Host, the value goes there; nothing is kept here", async () => {
		const p = portsOf();
		p.calls.setHome({ hostId: "host-1", personId: "person-ada" });
		const saved: unknown[] = [];
		p.calls.addHost("host-1", {
			secrets: { set: async (input: unknown) => void saved.push(input) },
		});
		await savePersonalSecret(p)({ name: "A_TOKEN", value: "value-a" });
		expect(p.calls.asked[0]?.olderHost).toBe(OLDER);
		expect(saved).toEqual([{ name: "A_TOKEN", value: "value-a" }]);
		expect(p.store.rows.size).toBe(0);
	});

	test("a Home Host without a link cannot be reached", async () => {
		const p = portsOf();
		p.calls.setHome({ hostId: "host-1", personId: "person-ada" });
		await expect(
			savePersonalSecret(p)({ name: "A_TOKEN", value: "value-a" }),
		).rejects.toHaveProperty("name", "HostUnreachableError");
		expect(p.store.rows.size).toBe(0);
	});
});
