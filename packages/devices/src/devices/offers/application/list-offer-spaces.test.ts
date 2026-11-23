import { expect, test } from "bun:test";
import { inMemoryOfferNeighbours } from "../adapters/out/in-memory-neighbours";
import { listOfferSpaces } from "./list-offer-spaces";

test("lists a shared Space the owner may offer to, then a Personal", async () => {
	const world = inMemoryOfferNeighbours();
	world.addSpace({ id: "team", name: "Team", personal: false, role: "owner" });
	world.addSpace({
		id: "own",
		name: "Personal",
		personal: true,
		role: "owner",
	});
	world.addSpace({
		id: "read",
		name: "Read",
		personal: false,
		role: "viewer",
	});
	world.setHome(["ada", "bea"]);
	world.setPersonal("bea", "bea-home");
	world.setName("bea", "Bea");
	const spaces = await listOfferSpaces(world)();
	expect(spaces).toEqual([
		{ id: "team", name: "Team", personal: false },
		{ id: "bea-home", name: "Personal of Bea", personal: true },
	]);
});

test("a Personal kept by another Host is not offered to", async () => {
	const world = inMemoryOfferNeighbours();
	world.setHome(["bea"]);
	world.setPersonal("bea", "bea-home");
	world.setHost("bea-home", "other-host");
	expect(await listOfferSpaces(world)()).toEqual([]);
});
