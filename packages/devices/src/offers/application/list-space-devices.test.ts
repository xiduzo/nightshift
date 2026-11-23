import { expect, test } from "bun:test";
import { inMemoryOfferNeighbours } from "../adapters/out/in-memory-neighbours";
import { listSpaceDevices } from "./list-space-devices";

test("a Device with no name is A device, and mine follows who offered", async () => {
	const world = inMemoryOfferNeighbours();
	world.setProjects("team", [
		{
			id: "proj",
			name: "Notes",
			clones: [{ deviceId: "other", deviceName: null, thisDevice: false }],
		},
	]);
	world.setListed("team", [
		{
			deviceId: "self",
			deviceName: "This computer",
			profile: "coder",
			profileName: "Coder",
			permissionCap: "default",
			sessionCap: 1,
			offeredAt: 1,
			by: "ada",
		},
	]);
	world.setMemberName("team", "ada", "Ada");
	const devices = await listSpaceDevices(world)("team", "ada");
	expect(devices).toEqual([
		expect.objectContaining({
			id: "other",
			name: "A device",
			mine: false,
			thisDevice: false,
		}),
		expect.objectContaining({
			id: "self",
			name: "This computer",
			mine: true,
			owner: "Ada",
			online: true,
			offers: [
				{
					profile: "coder",
					profileName: "Coder",
					permissionCap: "default",
					sessionCap: 1,
				},
			],
		}),
	]);
});
