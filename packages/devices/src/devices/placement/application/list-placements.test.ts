import { expect, test } from "bun:test";
import {
	GUEST,
	inMemoryPlacement,
	OWNER,
	PROJECT,
	pairedDevice,
	SPACE,
	WALKER,
} from "../adapters/out/in-memory-neighbours";
import { listPlacements } from "./list-placements";

test("a run can be placed on the Devices online with a Clone, never on a development install", async () => {
	const { ports } = inMemoryPlacement({
		paired: [
			pairedDevice("laptop", { name: "Laptop" }),
			pairedDevice("off"),
			pairedDevice("bare"),
			pairedDevice("dev", { dev: true }),
		],
		online: ["laptop", "bare", "dev"],
		clones: ["laptop", "off", "dev"],
	});
	expect(await listPlacements(ports)(SPACE, OWNER, PROJECT)).toEqual([
		{ deviceId: WALKER, name: "This computer", thisDevice: true },
		{ deviceId: "laptop", name: "Laptop", thisDevice: false },
	]);
});

test("a place of another Person says what it offers and who owns this computer", async () => {
	const { ports } = inMemoryPlacement({
		offersHere: ["coder"],
		names: { [OWNER]: "Olivia" },
	});
	expect(await listPlacements(ports)(SPACE, GUEST, PROJECT)).toEqual([
		{
			deviceId: WALKER,
			name: "This computer",
			thisDevice: true,
			offers: ["coder"],
			ownerName: "Olivia",
		},
	]);
});
