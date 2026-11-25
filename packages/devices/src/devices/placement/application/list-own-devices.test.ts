import { describe, expect, test } from "bun:test";
import type { DeviceProfile } from "@nightshift/engine";
import { Refusal } from "@nightshift/refusal";
import {
	deviceCopy,
	GUEST,
	inMemoryPlacement,
	listedDevice,
	OWNER,
	type PlacementWorld,
	PROJECT,
	pairedDevice,
	SPACE,
	WALKER,
} from "../adapters/out/in-memory-neighbours";
import { listOwnDevices } from "./list-own-devices";

const list = (world: PlacementWorld, person = OWNER) =>
	listOwnDevices(inMemoryPlacement(world).ports)(SPACE, person, PROJECT);

describe("this computer", () => {
	const ownProfiles: DeviceProfile[] = [
		{ id: "p-1", name: "one", kind: "agent" },
	];

	test("comes first, online, with the profiles of its owner", async () => {
		expect(await list({ ownProfiles })).toEqual([
			{
				deviceId: WALKER,
				name: "This computer",
				thisDevice: true,
				online: true,
				hasClone: true,
				profiles: ownProfiles,
			},
		]);
		expect((await list({}))[0]).not.toHaveProperty("profiles");
	});

	test("has the project by its Clone here, or when the project needs none", async () => {
		const has = async (world: PlacementWorld) =>
			(await list({ repoPath: null, ...world }))[0]?.hasClone;
		expect(await has({})).toBe(false);
		expect(await has({ folder: false })).toBe(true);
	});
});

describe("in a Space kept here", () => {
	test("the Person's paired Devices with access follow, as the work relay and the Clones tell them", async () => {
		const devices = await list({
			paired: [
				pairedDevice("laptop", { name: "Laptop" }),
				pairedDevice("dev", { dev: true }),
				pairedDevice("removed", { revokedAt: 1 }),
				pairedDevice(WALKER),
				pairedDevice("theirs", { ownerId: GUEST }),
			],
			online: ["dev"],
			clones: ["laptop"],
			kept: [deviceCopy("laptop")],
		});
		expect(devices.slice(1)).toEqual([
			{
				deviceId: "laptop",
				name: "Laptop",
				thisDevice: false,
				online: false,
				hasClone: true,
				profiles: deviceCopy("laptop").profiles,
			},
			{
				deviceId: "dev",
				name: "dev",
				thisDevice: false,
				online: true,
				hasClone: false,
				dev: true,
			},
		]);
	});
});

describe("in a Space a Host keeps", () => {
	test("the Host's list follows without this computer, with the profiles of a copy", async () => {
		const devices = await list({
			hosted: { devices: [listedDevice(WALKER), listedDevice("laptop")] },
			copies: [deviceCopy("laptop")],
		});
		expect(devices.slice(1)).toEqual([
			listedDevice("laptop", { profiles: deviceCopy("laptop").profiles }),
		]);
	});

	test("a refusal of the Host stands", async () => {
		const refuses = new Refusal("forbidden", "Not yours.");
		await expect(
			list({ hosted: { refuses }, copies: [deviceCopy("laptop")] }),
		).rejects.toBe(refuses);
	});

	const away: PlacementWorld = {
		hosted: { unreachable: true },
		copies: [deviceCopy("laptop", { name: null })],
		deviceNames: { laptop: "named in the Space" },
		clones: ["laptop"],
	};

	test("while it cannot be reached, the copies follow offline, with the names of the Space", async () => {
		expect((await list(away)).slice(1)).toEqual([
			{
				deviceId: "laptop",
				name: "named in the Space",
				thisDevice: false,
				online: false,
				hasClone: true,
				profiles: deviceCopy("laptop").profiles,
			},
		]);
	});

	test("copies count for this computer's Person only, and only at the home Host", async () => {
		expect(await list(away, GUEST)).toHaveLength(1);
		expect(await list({ ...away, keptByHome: false })).toHaveLength(1);
		// The Host knows the owner by another id.
		const known = { [OWNER]: "on-host" };
		expect(await list({ ...away, known }, "on-host")).toHaveLength(2);
	});
});
