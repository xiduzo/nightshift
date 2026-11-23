import { describe, expect, test } from "bun:test";
import { Refusal } from "@nightshift/refusal";
import { inMemoryHostPorts } from "../adapters/out/in-memory-neighbours";
import { NOT_YOURS_HERE, REMOVE_ACCESS_FIRST } from "../domain/words";
import { forgetDevice } from "./forget-device";

describe("forgetDevice", () => {
	test("a Device whose access is gone leaves with its Clones", async () => {
		const p = inMemoryHostPorts();
		p.registry.put({
			id: "laptop",
			name: "laptop",
			platform: "test",
			ownerId: "person-ada",
			homeHost: "https://studio.invalid",
			lastSeenAt: null,
			online: false,
			pairedAt: 0,
			revokedAt: 5,
		});
		await forgetDevice(p)({ personId: "person-ada", deviceId: "laptop" });
		expect(p.clones.ids).toEqual(["laptop"]);
		expect(await p.registry.get("laptop")).toBeNull();
	});

	test("refuses another Person's Device, and one that still has access", async () => {
		const p = inMemoryHostPorts();
		p.registry.put({
			id: "laptop",
			name: "laptop",
			platform: "test",
			ownerId: "person-ada",
			homeHost: "https://studio.invalid",
			lastSeenAt: null,
			online: true,
			pairedAt: 0,
			revokedAt: null,
		});
		await expect(
			forgetDevice(p)({ personId: "person-bob", deviceId: "laptop" }),
		).rejects.toThrow(NOT_YOURS_HERE);
		await expect(
			forgetDevice(p)({ personId: "person-ada", deviceId: "laptop" }),
		).rejects.toBeInstanceOf(Refusal);
		await expect(
			forgetDevice(p)({ personId: "person-ada", deviceId: "laptop" }),
		).rejects.toThrow(REMOVE_ACCESS_FIRST);
	});
});
