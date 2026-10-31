import { describe, expect, test } from "bun:test";

import { knownComputers, offlineNeeds } from "./needs";
import type { DevicesOverview, SpaceDevice } from "./types";

const space = (
	over: Partial<SpaceDevice> & Pick<SpaceDevice, "id" | "name">,
): SpaceDevice => ({
	online: null,
	thisDevice: false,
	mine: false,
	owner: null,
	platform: null,
	lastSeenAt: null,
	clones: [],
	offers: [],
	...over,
});

const overview = {
	thisComputer: { id: "host", name: "studio" },
	devices: [
		{ id: "mini", name: "Mac mini", online: false, revokedAt: null },
		{ id: "old", name: "Old laptop", online: true, revokedAt: 5 },
	],
} as unknown as DevicesOverview;

describe("offlineNeeds", () => {
	const known = knownComputers(overview, [
		space({ id: "mbp", name: "MacBook Pro", online: false }),
		space({ id: "pc", name: "Tower", online: true }),
		space({ id: "far", name: "Far away" }),
		space({ id: "host", name: "studio", thisDevice: true }),
	]);

	test("names each computer the flow needs that is offline, once", () => {
		expect(
			offlineNeeds(
				{
					names: ["MacBook Pro", "Tower", "studio", "MacBook Pro"],
					ids: ["mbp", "mini"],
				},
				known,
			),
		).toEqual(["MacBook Pro", "Mac mini"]);
	});

	test("a computer whose access was removed is offline", () => {
		expect(offlineNeeds({ names: [], ids: ["old"] }, known)).toEqual([
			"Old laptop",
		]);
	});

	test("says nothing of a computer it does not know or cannot tell about", () => {
		expect(
			offlineNeeds({ names: ["Far away", "Nowhere"], ids: ["x"] }, known),
		).toEqual([]);
	});

	test("the Host is online, also before the other reads arrive", () => {
		expect(
			offlineNeeds(
				{ names: ["studio"], ids: [] },
				knownComputers(overview, undefined),
			),
		).toEqual([]);
		expect(knownComputers(undefined, undefined)).toEqual([]);
	});
});
