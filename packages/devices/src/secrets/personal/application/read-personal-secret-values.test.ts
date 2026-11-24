import { describe, expect, test } from "bun:test";
import { personalPorts } from "../test-support";
import { readPersonalSecretValues } from "./read-personal-secret-values";

describe("readPersonalSecretValues", () => {
	test("without a Home Host, this computer gives its owner's values itself", async () => {
		const p = await personalPorts();
		await p.store.set("person-ada", "A_TOKEN", "value-a", null);
		expect(await readPersonalSecretValues(p)({ names: ["A_TOKEN"] })).toEqual({
			A_TOKEN: "value-a",
		});
	});

	test("with a Home Host, the call goes there; nothing is kept here", async () => {
		const p = await personalPorts();
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
		expect(askedFor).toEqual([{ names: ["A_TOKEN"] }]);
		expect(await p.rows()).toEqual([]);
	});

	test("no name asks nothing", async () => {
		const p = await personalPorts();
		p.calls.setHome({ hostId: "host-1", personId: "person-ada" });
		expect(await readPersonalSecretValues(p)({ names: [] })).toEqual({});
		expect(p.calls.asked).toEqual([]);
	});
});
