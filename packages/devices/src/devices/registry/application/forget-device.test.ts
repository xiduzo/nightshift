import { describe, expect, test } from "bun:test";
import { Refusal } from "@nightshift/refusal";
import { registryPorts } from "../test-support";
import { forgetDevice } from "./forget-device";

/** The use case forgetDevice, over a database in memory. */

describe("forgetDevice", () => {
	test("forgetting removes a revoked Device for good, the engine's rows of it first", async () => {
		const p = await registryPorts();
		await p.add({ id: "device-b", revokedAt: 5 });
		p.online.set("device-b", 1);
		await forgetDevice(p)({ id: "device-b" });
		expect(await p.store.paired("device-b")).toBeNull();
		expect(await p.engineRan()).toEqual(["forget device-b"]);
		expect(p.online.has("device-b")).toBe(false);
	});

	test("never one with access", async () => {
		const p = await registryPorts();
		await p.add({ id: "device-b" });
		const refused = forgetDevice(p)({ id: "device-b" });
		await expect(refused).rejects.toBeInstanceOf(Refusal);
		await expect(refused).rejects.toThrow(
			"Remove the access of this device first.",
		);
		expect(await p.engineRan()).toEqual([]);
	});

	test("an unknown Device changes nothing", async () => {
		const p = await registryPorts();
		await forgetDevice(p)({ id: "nobody" });
		expect(await p.engineRan()).toEqual([]);
	});
});
