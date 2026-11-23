import { expect, test } from "bun:test";
import { inMemoryOfferNeighbours } from "../adapters/out/in-memory-neighbours";
import { noteProfileRenamed } from "./note-profile-renamed";

const caps = { permissionCap: "default" as const, sessionCap: 1 };

test("publishes the new name where the Space still lists the Offer", async () => {
	const world = inMemoryOfferNeighbours();
	world.addProfile({ id: "coder", name: "Maker", agent: true });
	await world.deviceOffers.set({
		spaceId: "team",
		profile: "coder",
		...caps,
		offeredAt: 1,
	});
	await world.deviceOffers.set({
		spaceId: "gone",
		profile: "coder",
		...caps,
		offeredAt: 1,
	});
	world.setListed("team", [
		{
			deviceId: "self",
			deviceName: "This computer",
			profile: "coder",
			profileName: "Coder",
			...caps,
			offeredAt: 1,
			by: "ada",
		},
	]);
	await noteProfileRenamed(world)("coder", "ada");
	expect(world.published).toEqual([
		expect.objectContaining({
			spaceId: "team",
			profile: "coder",
			profileName: "Maker",
		}),
	]);
});

test("a Space that cannot be reached keeps the old name", async () => {
	const world = inMemoryOfferNeighbours();
	world.addProfile({ id: "coder", name: "Maker", agent: true });
	await world.deviceOffers.set({
		spaceId: "team",
		profile: "coder",
		...caps,
		offeredAt: 1,
	});
	world.setListed("team", [
		{
			deviceId: "self",
			deviceName: "This computer",
			profile: "coder",
			profileName: "Coder",
			...caps,
			offeredAt: 1,
			by: "ada",
		},
	]);
	world.spaceOffers.publish = async () => {
		throw "offline";
	};
	await noteProfileRenamed(world)("coder", "ada");
	expect(world.published).toEqual([]);
});
