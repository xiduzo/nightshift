import { describe, expect, test } from "bun:test";
import { Refusal } from "@nightshift/refusal";
import { registryPorts } from "../test-support";
import { joinDevice } from "./join-device";

/** The use case joinDevice, over a database in memory. */

const macbook = {
	id: "device-b",
	name: "MacBook",
	platform: "darwin",
	ownerId: "person-ada",
	homeHost: "https://host.example",
};

describe("joinDevice", () => {
	test("a Device that pairs gets its row and DeviceJoined, in its owner's personal Space", async () => {
		const ports = await registryPorts();
		ports.spaces.add("person-ada");
		const paired = await joinDevice(ports)(macbook);
		expect(paired).toMatchObject({
			id: "device-b",
			name: "MacBook",
			ownerId: "person-ada",
			homeHost: "https://host.example",
			online: false,
			revokedAt: null,
		});
		expect(ports.facts.logged).toEqual([
			{
				fact: {
					type: "DeviceJoined",
					payload: {
						deviceId: "device-b",
						name: "MacBook",
						platform: "darwin",
						ownerId: "person-ada",
						home: true,
					},
					spaceId: "personal-person-ada",
				},
				withRows: true,
			},
		]);
	});

	test("this computer cannot pair with itself", async () => {
		const ports = await registryPorts();
		await ports.add({ id: "device-b", self: true });
		const refused = joinDevice(ports)(macbook);
		await expect(refused).rejects.toBeInstanceOf(Refusal);
		await expect(refused).rejects.toThrow(
			"A computer cannot pair with itself.",
		);
	});

	test("an owner without a personal Space logs nothing and records nothing", async () => {
		const ports = await registryPorts();
		await expect(joinDevice(ports)(macbook)).rejects.toThrow(
			"The Device's owner has no personal Space.",
		);
		expect(await ports.store.paired("device-b")).toBeNull();
	});
});
