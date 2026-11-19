import { expect, test } from "bun:test";
import { directorySpaceKeeper } from "./directory-space-keeper";
import { inMemorySpaceKeeper } from "./in-memory-space-keeper";
import { spaceKeeperContract } from "./space-keeper.contract";

/**
 * The contract of `SpaceKeeper`, on both adapters. The real side runs
 * over a Device directory that knows one Host, and Links whose state the
 * test sets (the real directory and Links are `@nightshift/devices`).
 */

spaceKeeperContract("in memory", async () => {
	const keeper = inMemorySpaceKeeper();
	keeper.hostedBy("space-host", "host-h");
	return {
		keeper,
		link: (up) => keeper.link("space-host", up),
		close: async () => {},
	};
});

spaceKeeperContract("over the Device directory and the Links", async () => {
	const hosts = new Map([["space-host", "host-h"]]);
	let up = false;
	return {
		keeper: directorySpaceKeeper({
			directory: {
				hostedElsewhere: async (spaceId) => hosts.has(spaceId),
				hostOf: async (spaceId) => hosts.get(spaceId) ?? null,
			},
			// A Link answers for a Space a Host keeps: false for this Replica's own.
			relay: { reachable: async (spaceId) => up && hosts.has(spaceId) },
		}),
		link: (next) => {
			up = next;
		},
		close: async () => {},
	};
});

test("without Links, this computer reaches no Host", async () => {
	const keeper = directorySpaceKeeper({
		directory: {
			hostedElsewhere: async () => true,
			hostOf: async () => "host-h",
		},
	});
	expect(await keeper.reachable("space-host")).toBe(false);
});
