import { expect, test } from "bun:test";
import { inMemoryOfferNeighbours } from "../adapters/out/in-memory-neighbours";
import { makeOffer } from "./make-offer";

const caps = { permissionCap: "default" as const, sessionCap: 1 };

test("a removed profile is refused", async () => {
	const world = inMemoryOfferNeighbours();
	await expect(
		makeOffer(world)({ spaceId: "team", profile: "gone", ...caps }, "ada"),
	).rejects.toThrow("This profile was removed. Add it under Agents first.");
});

test("a Decision profile cannot be offered", async () => {
	const world = inMemoryOfferNeighbours();
	world.addProfile({ id: "judge", name: "Judge", agent: false });
	await expect(
		makeOffer(world)({ spaceId: "team", profile: "judge", ...caps }, "ada"),
	).rejects.toThrow(
		'The profile "Judge" is for Decision and Value nodes. Only an agent profile can be offered.',
	);
});

test("a personal Space is refused", async () => {
	const world = inMemoryOfferNeighbours();
	world.addProfile({ id: "coder", name: "Coder", agent: true });
	world.addSpace({
		id: "personal",
		name: "Personal",
		personal: true,
		role: "owner",
	});
	await expect(
		makeOffer(world)({ spaceId: "personal", profile: "coder", ...caps }, "ada"),
	).rejects.toThrow(
		"Nobody else is in your personal Space. Offer the profile to a shared Space.",
	);
});

test("a role that cannot offer is refused", async () => {
	const world = inMemoryOfferNeighbours();
	world.addProfile({ id: "coder", name: "Coder", agent: true });
	world.addSpace({
		id: "team",
		name: "Team",
		personal: false,
		role: "member",
	});
	await expect(
		makeOffer(world)({ spaceId: "team", profile: "coder", ...caps }, "ada"),
	).rejects.toThrow("Your role in that Space does not let you offer profiles.");
});

test("an unknown Space is refused", async () => {
	const world = inMemoryOfferNeighbours();
	world.addProfile({ id: "coder", name: "Coder", agent: true });
	await expect(
		makeOffer(world)({ spaceId: "missing", profile: "coder", ...caps }, "ada"),
	).rejects.toThrow("That Space does not exist.");
});

test("publishes in the Space before it keeps its own entry", async () => {
	const world = inMemoryOfferNeighbours();
	world.addProfile({ id: "coder", name: "Coder", agent: true });
	world.addSpace({ id: "team", name: "Team", personal: false, role: "owner" });
	world.setClock(50);
	await makeOffer(world)({ spaceId: "team", profile: "coder", ...caps }, "ada");
	expect(world.order).toEqual(["publish"]);
	expect(world.published[0]).toMatchObject({
		spaceId: "team",
		profile: "coder",
		profileName: "Coder",
		deviceId: "self",
		by: "ada",
	});
	expect(world.deviceOffers.entries.get("team/coder")).toMatchObject({
		offeredAt: 50,
	});
});
