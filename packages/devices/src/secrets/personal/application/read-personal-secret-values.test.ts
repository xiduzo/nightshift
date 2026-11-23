import { describe, expect, test } from "bun:test";
import { inMemoryHostCalls } from "../../calls/adapters/out/in-memory-host-calls";
import { inMemoryPersonalSecretStore } from "../../kept/adapters/out/in-memory-personal-secret-store";
import { readPersonalSecretValues } from "./read-personal-secret-values";

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

describe("readPersonalSecretValues", () => {
	test("without a Home Host, this computer gives its owner's values itself", async () => {
		const p = portsOf();
		await p.store.set("person-ada", "A_TOKEN", "value-a", null);
		expect(await readPersonalSecretValues(p)({ names: ["A_TOKEN"] })).toEqual({
			A_TOKEN: "value-a",
		});
	});

	test("with a Home Host, the call goes there; nothing is kept here", async () => {
		const p = portsOf();
		p.calls.setHome({ hostId: "host-1", personId: "person-ada" });
		const askedFor: unknown[] = [];
		p.calls.addHost("host-1", {
			secrets: {
				values: async (input: unknown) => {
					askedFor.push(input);
					return { A_TOKEN: "value-a" };
				},
			},
		});
		expect(await readPersonalSecretValues(p)({ names: ["A_TOKEN"] })).toEqual({
			A_TOKEN: "value-a",
		});
		expect(p.calls.asked[0]?.olderHost).toBe(OLDER);
		expect(askedFor).toEqual([{ names: ["A_TOKEN"] }]);
		expect(p.store.rows.size).toBe(0);
	});

	test("no name asks nothing", async () => {
		const p = portsOf();
		p.calls.setHome({ hostId: "host-1", personId: "person-ada" });
		expect(await readPersonalSecretValues(p)({ names: [] })).toEqual({});
		expect(p.calls.asked).toEqual([]);
	});
});
