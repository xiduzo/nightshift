import { expect, test } from "bun:test";
import { inMemoryOfferNeighbours } from "../adapters/out/in-memory-neighbours";
import { listOffers } from "./list-offers";

test("a Space the owner left keeps that name", async () => {
	const world = inMemoryOfferNeighbours();
	await world.deviceOffers.set({
		spaceId: "left",
		profile: "coder",
		permissionCap: "default",
		sessionCap: 1,
		offeredAt: 1,
	});
	world.addProfile({ id: "coder", name: "Coder", agent: true });
	const [offer] = await listOffers(world)();
	expect(offer?.spaceName).toBe("A Space you left");
	expect(offer?.profileName).toBe("Coder");
	expect(offer?.listed).toBe(false);
});

test("a removed profile stays listed under its id", async () => {
	const world = inMemoryOfferNeighbours();
	await world.deviceOffers.set({
		spaceId: "left",
		profile: "gone",
		permissionCap: "default",
		sessionCap: 1,
		offeredAt: 1,
	});
	const [offer] = await listOffers(world)();
	expect(offer?.profileName).toBe("gone");
});
