import { describe, expect, test } from "bun:test";
import type { DeviceKeyAccess } from "@nightshift/auth";
import { inMemoryHostPorts } from "../adapters/out/in-memory-neighbours";
import { NO_ACCESS } from "../domain/words";
import { answerHello } from "./answer-hello";

const key = (deviceId: string, personId: string): DeviceKeyAccess => ({
	keyId: `key-${deviceId}`,
	deviceId,
	personId,
	permissions: { sync: ["pull", "push"] },
});

describe("answerHello", () => {
	test("a home Device gets the personal Space and the owner's other Devices; a guest Device does not", async () => {
		const p = inMemoryHostPorts();
		p.spaces.spaces.push(
			{ id: "personal", name: "Personal", personal: true, role: "owner" },
			{ id: "platform", name: "Platform", personal: false, role: "owner" },
		);
		p.registry.put({
			id: "laptop",
			name: "laptop",
			platform: "test",
			ownerId: "person-ada",
			homeHost: "https://studio.invalid",
			lastSeenAt: null,
			online: false,
			pairedAt: 0,
			revokedAt: null,
		});
		p.registry.put({
			id: "desktop",
			name: "desktop",
			platform: "test",
			ownerId: "person-ada",
			homeHost: "https://studio.invalid",
			lastSeenAt: null,
			online: true,
			pairedAt: 0,
			revokedAt: null,
		});
		p.registry.setSelfOwner("person-ada");
		const home = await answerHello(p)(key("laptop", "person-ada"));
		expect(home.spaces.map((s) => s.name)).toEqual(["Personal", "Platform"]);
		expect(home.devices).toEqual([
			{ id: "host-a", name: "Studio" },
			{ id: "desktop", name: "desktop" },
		]);
		expect(p.registry.seenIds).toEqual(["laptop"]);
		p.registry.put({
			id: "travel",
			name: "travel",
			platform: "test",
			ownerId: "person-ada",
			homeHost: null,
			lastSeenAt: null,
			online: false,
			pairedAt: 0,
			revokedAt: null,
		});
		const guest = await answerHello(p)(key("travel", "person-ada"));
		expect(guest.spaces.map((s) => s.name)).toEqual(["Platform"]);
		expect(guest.devices).toBeUndefined();
	});

	test("another Person's Device learns neither the Host nor its owner's Devices; the Host admin learns they are", async () => {
		const p = inMemoryHostPorts();
		p.registry.setSelfOwner("person-ada");
		p.spaces.admins.add("person-ada");
		for (const [id, ownerId] of [
			["laptop", "person-ada"],
			["bobs", "person-bob"],
		] as const) {
			p.registry.put({
				id,
				name: id,
				platform: "test",
				ownerId,
				homeHost: "https://studio.invalid",
				lastSeenAt: null,
				online: false,
				pairedAt: 0,
				revokedAt: null,
			});
		}
		const bobs = await answerHello(p)(key("bobs", "person-bob"));
		expect(bobs.devices).toEqual([]);
		expect(bobs.hostAdmin).toBe(false);
		const adas = await answerHello(p)(key("laptop", "person-ada"));
		expect(adas.hostAdmin).toBe(true);
	});

	test("a Device without access is refused", async () => {
		const p = inMemoryHostPorts();
		await expect(answerHello(p)(key("ghost", "person-ada"))).rejects.toThrow(
			NO_ACCESS,
		);
		p.registry.put({
			id: "gone",
			name: "gone",
			platform: "test",
			ownerId: "person-ada",
			homeHost: "https://studio.invalid",
			lastSeenAt: null,
			online: false,
			pairedAt: 0,
			revokedAt: 5,
		});
		await expect(answerHello(p)(key("gone", "person-ada"))).rejects.toThrow(
			NO_ACCESS,
		);
	});
});
