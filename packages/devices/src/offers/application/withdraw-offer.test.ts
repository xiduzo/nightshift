import { expect, test } from "bun:test";
import { inMemoryOfferNeighbours } from "../adapters/out/in-memory-neighbours";
import { withdrawOffer } from "./withdraw-offer";

test("removes its own entry, then the Space, then aborts the calls", async () => {
	const world = inMemoryOfferNeighbours();
	await world.deviceOffers.set({
		spaceId: "team",
		profile: "coder",
		permissionCap: "default",
		sessionCap: 1,
		offeredAt: 1,
	});
	await withdrawOffer(world)({ spaceId: "team", profile: "coder" }, "ada");
	expect(world.deviceOffers.entries.has("team/coder")).toBe(false);
	expect(world.withdrawn).toEqual([
		{ spaceId: "team", profile: "coder", deviceId: "self", by: "ada" },
	]);
	expect(world.order).toEqual(["withdraw", "abort"]);
});

test("aborts the calls when the Space cannot be reached", async () => {
	const world = inMemoryOfferNeighbours();
	world.spaceOffers.withdraw = async () => {
		world.order.push("withdraw");
		throw new Error("The Host cannot be reached.");
	};
	await expect(
		withdrawOffer(world)({ spaceId: "team", profile: "coder" }, "ada"),
	).rejects.toThrow("The Host cannot be reached.");
	expect(world.order).toEqual(["withdraw", "abort"]);
});
