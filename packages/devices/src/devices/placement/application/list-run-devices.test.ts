import { describe, expect, test } from "bun:test";
import {
	deviceCopy,
	GUEST,
	inMemoryPlacement,
	listedDevice,
	OWNER,
	type PlacementWorld,
	PROJECT,
	pairedDevice,
	SELF,
	SPACE,
	WALKER,
} from "../adapters/out/in-memory-neighbours";
import { listRunDevices } from "./list-run-devices";

const list = (world: PlacementWorld, person = OWNER, ownOnly?: boolean) =>
	listRunDevices(inMemoryPlacement(world).ports)(
		SPACE,
		person,
		PROJECT,
		ownOnly,
	);
const CODER = [{ id: "p-coder", name: "coder", kind: "agent" as const }];

describe("the Devices that offer a profile", () => {
	const world: PlacementWorld = {
		paired: [
			pairedDevice("laptop"),
			pairedDevice("theirs", { ownerId: GUEST, name: "Theirs" }),
			pairedDevice("removed", { ownerId: GUEST, revokedAt: 1 }),
		],
		online: ["theirs"],
		offering: {
			[SELF]: ["coder"],
			[WALKER]: ["coder"],
			laptop: ["coder"],
			theirs: ["coder"],
			removed: ["coder"],
			elsewhere: ["coder"],
		},
		clones: ["elsewhere"],
	};

	test("follow the Person's own: never this computer, an own Device or a removed one", async () => {
		expect((await list(world)).slice(1)).toEqual([
			{
				deviceId: "laptop",
				name: "laptop",
				thisDevice: false,
				online: false,
				hasClone: false,
			},
			{
				deviceId: "theirs",
				name: "Theirs",
				thisDevice: false,
				online: true,
				hasClone: false,
				offers: ["coder"],
				profiles: CODER,
			},
			{
				deviceId: "elsewhere",
				name: "published elsewhere",
				thisDevice: false,
				online: false,
				hasClone: true,
				offers: ["coder"],
				profiles: CODER,
			},
		]);
	});

	test("do not count when the Person asks for their own", async () => {
		expect((await list(world, OWNER, true)).map((d) => d.deviceId)).toEqual([
			WALKER,
			"laptop",
		]);
	});

	test("do not count as the Person's own when the Host lists them, also with no Offers", async () => {
		const devices = [
			listedDevice("laptop"),
			listedDevice("theirs", { offers: [] }),
		];
		expect(
			(await list({ hosted: { devices } }, OWNER, true)).map((d) => d.deviceId),
		).toEqual([WALKER, "laptop"]);
	});

	test("come once when the Host lists them too", async () => {
		const devices = await list({
			offering: { laptop: ["coder"] },
			hosted: { devices: [listedDevice("laptop")] },
		});
		expect(devices.map((d) => d.deviceId)).toEqual([WALKER, "laptop"]);
	});
});

describe("this computer", () => {
	const offersHere = ["coder"];

	test("shows its owner everything, also as the Host knows them", async () => {
		expect((await list({ offersHere }))[0]).not.toHaveProperty("offers");
		const known = { [OWNER]: "on-host", person: "on-host" };
		expect((await list({ offersHere, known }, "person"))[0]).not.toHaveProperty(
			"offers",
		);
	});

	test("shows another Person its Offers and the name of its owner", async () => {
		const names = { [OWNER]: "Olivia" };
		expect((await list({ offersHere, names }, GUEST))[0]).toEqual({
			deviceId: WALKER,
			name: "This computer",
			thisDevice: true,
			online: true,
			hasClone: true,
			offers: ["coder"],
			profiles: [{ id: "p-coder", name: "coder", kind: "agent" }],
			ownerName: "Olivia",
		});
	});

	test("names no owner that nobody knows", async () => {
		for (const world of [{ selfOwner: null }, { names: { [OWNER]: "" } }]) {
			expect((await list(world, GUEST))[0]).not.toHaveProperty("ownerName");
		}
	});
});

describe("the calls of the ports, in order", () => {
	const callsOf = async (world: PlacementWorld) => {
		const { ports, calls } = inMemoryPlacement(world);
		await listRunDevices(ports)(SPACE, OWNER, PROJECT);
		return calls;
	};

	test("in a Space kept here", async () => {
		expect(
			await callsOf({
				paired: [
					pairedDevice("laptop"),
					pairedDevice("theirs", { ownerId: GUEST }),
				],
				offering: { theirs: ["coder"] },
			}),
		).toEqual([
			...["find", "walkerId", "hostOf", "clones", "list"],
			...["kept", "online"],
			...["selfOwnerId", "personInSpace", "personInSpace"],
			...["find", "open", "clones", "walkerId", "get", "online"],
		]);
	});

	test("in a Space a Host keeps", async () => {
		expect(
			await callsOf({
				hosted: { devices: [listedDevice("laptop")] },
				copies: [deviceCopy("laptop")],
			}),
		).toEqual([
			...["find", "walkerId", "hostOf", "keptByHomeHost"],
			...["selfOwnerId", "personInSpace", "copies", "host"],
			...["selfOwnerId", "personInSpace", "personInSpace"],
			...["find", "open", "clones", "walkerId"],
		]);
	});
});
