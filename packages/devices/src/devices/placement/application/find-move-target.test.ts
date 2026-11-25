import { expect, test } from "bun:test";
import {
	inMemoryPlacement,
	type PlacementWorld,
	pairedDevice,
	placedRun,
	WALKER,
} from "../adapters/out/in-memory-neighbours";
import { findMoveTarget } from "./find-move-target";

const move = (to: string, world: PlacementWorld = {}, person = "person") =>
	findMoveTarget(
		inMemoryPlacement({
			paired: [pairedDevice("laptop", { name: "Laptop", ownerId: "on-host" })],
			known: { person: "on-host" },
			...world,
		}).ports,
	)(placedRun(), { personId: person, door: "session" }, to);

test("a move goes to a Device of the Person as the Host knows them", async () => {
	expect(await move("laptop")).toEqual({ id: "laptop", name: "Laptop" });
});

test("a move goes nowhere: to this computer, to another Person's Device, to an unknown one", async () => {
	expect(await move(WALKER)).toBeNull();
	expect(await move("laptop", {}, "guest")).toBeNull();
	expect(await move("nowhere")).toBeNull();
});

test("a move to an offline Device is refused", async () => {
	await expect(move("laptop", { online: [] })).rejects.toThrow(
		"Laptop is offline. Move the run when it is online.",
	);
});
