import { describe, expect, test } from "bun:test";
import type { PlanInput } from "@nightshift/engine";
import {
	deviceCopy,
	FLOW,
	GUEST,
	HOST,
	inMemoryPlacement,
	listedDevice,
	OWNER,
	offeredGroup,
	type PlacementWorld,
	PROJECT,
	pairedDevice,
	SELF,
	SPACE,
	WALKER,
} from "../adapters/out/in-memory-neighbours";
import { planRun } from "./plan-run";

type More = Partial<PlanInput> & {
	ports?: Partial<ReturnType<typeof inMemoryPlacement>["ports"]>;
};

/** Plans a run, and gives what its nodes are planned over. */
async function plan(
	world: PlacementWorld = {},
	startedBy: string | null = OWNER,
	{ ports: changed, ...more }: More = {},
) {
	const memory = inMemoryPlacement(world);
	const result = await planRun({ ...memory.ports, ...changed })({
		start: {
			projectId: PROJECT,
			flow: FLOW,
			...(startedBy ? { startedBy } : {}),
		},
		project: await inMemoryPlacement(world).ports.projects.find(PROJECT, SPACE),
		runId: "run-1",
		scheduled: false,
		byPerson: true,
		...more,
	});
	const [planned] = memory.planned;
	if (!planned) throw new Error("Nothing planned.");
	return { ...memory, ...planned, result };
}

const LAPTOP = pairedDevice("laptop", { name: "Laptop" });
const THEIRS = pairedDevice("theirs", { name: "Theirs", ownerId: GUEST });

/** One Device of a plan. */
const byId = async (
	world: PlacementWorld,
	id: string,
	startedBy: string | null = OWNER,
	more: More = {},
) => (await plan(world, startedBy, more)).devices.byId(id);

describe("the Person a run is planned for", () => {
	test("is the one a schedule names as it is, else the starter as the Host knows them", async () => {
		const world = { known: { person: "on-host" } };
		const scheduled = await plan(world, "person", { scheduled: true });
		expect(scheduled.personId).toBe("person");
		expect((await plan(world, "person")).personId).toBe("on-host");
	});

	test("is this computer's owner when nobody starts it", async () => {
		expect((await plan({}, null)).personId).toBe(OWNER);
	});
});

describe("this computer in a plan", () => {
	test("is the Walker, by either of its ids and as a node's Device", async () => {
		const { devices, result } = await plan();
		expect(devices.walker).toMatchObject({
			id: SELF,
			thisDevice: true,
			hasClone: true,
		});
		expect(devices.walker.offered).toBeUndefined();
		for (const id of [SELF, WALKER]) {
			expect(await devices.byId(id)).toBe(devices.walker);
			expect(await devices.nodeDevice(id)).toBe(devices.walker);
		}
		expect(result.run).toBe(devices.walker);
	});

	test("is the Walker for a node by the id that the list has of it", async () => {
		const { here } = inMemoryPlacement().ports;
		let walkerId = WALKER;
		const { devices } = await plan({}, OWNER, {
			ports: {
				here: {
					...here,
					walkerId: async () => {
						const now = walkerId;
						walkerId = "adopted";
						return now;
					},
				},
			},
		});
		walkerId = WALKER;
		expect(await devices.nodeDevice("adopted")).toBe(devices.walker);
	});

	test("has the project by its Clone", async () => {
		const { devices } = await plan({ repoPath: null });
		expect(devices.walker.hasClone).toBe(false);
	});

	test("takes another Person's run through its Offers, with their role", async () => {
		for (const mayUse of [true, false]) {
			const { devices } = await plan({ offersHere: ["coder"], mayUse }, GUEST);
			expect(devices.walker.offered).toMatchObject({
				deviceName: "This computer",
				mayUse,
				offers: [{ profileName: "coder" }],
			});
		}
	});
});

describe("another Device, in a Space kept here", () => {
	test("is one of the Person's, reached for them", async () => {
		const run = await plan({ paired: [LAPTOP], clones: ["laptop"] });
		const at = await run.devices.byId("laptop");
		expect(at).toMatchObject({
			id: "laptop",
			name: "Laptop",
			thisDevice: false,
			hasClone: true,
		});
		expect(at).not.toHaveProperty("offline");
		expect(at).not.toHaveProperty("offered");
		expect(run.reached).toEqual([
			{
				id: "laptop",
				starter: true,
				forRun: {
					spaceId: SPACE,
					projectId: PROJECT,
					personId: OWNER,
					runId: "run-1",
				},
			},
		]);
		expect(await run.devices.nodeDevice("laptop")).toMatchObject({
			id: "laptop",
		});
	});

	test("says when it is offline, and what Clone it lacks", async () => {
		expect(
			await byId({ paired: [LAPTOP], online: [], clones: [] }, "laptop"),
		).toMatchObject({ offline: true, hasClone: false });
	});

	test("is refused when it never paired, is removed, or no relay reaches it", async () => {
		const removed = { ...LAPTOP, revokedAt: 1 };
		for (const world of [
			{},
			{ paired: [removed] },
			{ paired: [LAPTOP], reaches: false },
		]) {
			await expect(byId(world, "laptop")).rejects.toThrow("unreachable");
		}
	});

	test("is refused to a run of nobody", async () => {
		await expect(
			byId({ paired: [LAPTOP], selfOwner: null }, "laptop", null),
		).rejects.toThrow("Laptop is not your device.");
	});

	/** A plan of nobody, on a computer whose owner is known from the second read on. */
	const ownerAppears = (world: PlacementWorld) => {
		const { people } = inMemoryPlacement(world).ports;
		let reads = 0;
		return plan(world, null, {
			ports: {
				people: {
					...people,
					ownerIn: async () => (reads++ === 0 ? null : OWNER),
				},
			},
		});
	};

	test("takes a run of nobody through its Offers when it is another Person's", async () => {
		const paired = [THEIRS];
		const none = await ownerAppears({ paired });
		await expect(none.devices.byId("theirs")).rejects.toThrow(
			"Theirs is not your device. It offers nothing to this Space.",
		);
		const offering = { theirs: ["coder"] };
		const run = await ownerAppears({ paired, offering, mayUse: true });
		expect((await run.devices.byId("theirs"))?.offered).toMatchObject({
			mayUse: true,
			offers: [{ profileName: "coder" }],
		});
	});

	test("is the owner's, for a run of nobody on a computer that gets its owner now", async () => {
		const run = await ownerAppears({ paired: [LAPTOP] });
		expect(run.personId).toBeNull();
		expect(await run.devices.byId("laptop")).toMatchObject({ id: "laptop" });
		expect(run.reached[0]?.forRun.personId).toBe(OWNER);
	});

	test("counts only its own Offers", async () => {
		const offering = { elsewhere: ["writer"], theirs: ["coder"] };
		const names = async (world: PlacementWorld) =>
			(await byId(world, "theirs"))?.offered?.offers.map((o) => o.profileName);
		expect(await names({ paired: [THEIRS], offering })).toEqual(["coder"]);
		const devices = [listedDevice("theirs", { offers: ["coder"] })];
		expect(await names({ hosted: { devices }, offering })).toEqual(["coder"]);
		await expect(
			byId({ paired: [THEIRS], offering: { elsewhere: ["coder"] } }, "theirs"),
		).rejects.toThrow("It offers nothing to this Space.");
	});

	test("is refused when it left the list since", async () => {
		const { registry } = inMemoryPlacement({ paired: [LAPTOP] }).ports;
		await expect(
			byId({}, "laptop", OWNER, {
				ports: { registry: { ...registry, list: async () => [] } },
			}),
		).rejects.toThrow("Laptop is offline. Start the run when it is online");
	});

	test("takes another Person's run through its Offers, with their role, and none without", async () => {
		const offering = { theirs: ["coder"] };
		for (const mayUse of [true, false]) {
			const at = await byId({ paired: [THEIRS], offering, mayUse }, "theirs");
			expect(at?.offered).toMatchObject({
				deviceName: "Theirs",
				mayUse,
				offers: [{ profileName: "coder" }],
			});
		}
		await expect(byId({ paired: [THEIRS] }, "theirs")).rejects.toThrow(
			"Theirs is not your device. It offers nothing to this Space.",
		);
	});
});

describe("another Device, in a Space a Host keeps", () => {
	test("is one the Host lists, and no other", async () => {
		const devices = [listedDevice("laptop", { online: false })];
		expect(await byId({ hosted: { devices } }, "laptop")).toMatchObject({
			id: "laptop",
			offline: true,
		});
		await expect(byId({ hosted: {} }, "laptop")).rejects.toThrow(
			"That device is not one of your devices on the Host of this Space.",
		);
	});

	test("takes another Person's run through its Offers, with their role", async () => {
		for (const mayUse of [true, false]) {
			const at = await byId(
				{
					hosted: { devices: [listedDevice("theirs", { offers: ["coder"] })] },
					offering: { theirs: ["coder"] },
					mayUse,
				},
				"theirs",
			);
			expect(at?.offered).toMatchObject({ deviceName: "theirs", mayUse });
		}
	});
});

describe("what the walk asks of the Devices", () => {
	test("a node that names a Device the Person cannot use has none", async () => {
		expect(await (await plan()).devices.nodeDevice("nowhere")).toBeNull();
	});

	test("the Host of the Space: it, this computer as a Host, or none", async () => {
		const named = async (world: PlacementWorld) => {
			const { devices } = await plan(world);
			return [devices.keeperId, devices.hostId];
		};
		expect(await named({ hosted: {}, isHost: true })).toEqual([HOST, HOST]);
		expect(await named({ isHost: true })).toEqual([WALKER, WALKER]);
		expect(await named({})).toEqual([WALKER, undefined]);
	});

	test("the profiles of a listed Device, and what an offline one last said", async () => {
		const profiles = [{ id: "p-1", name: "one", kind: "agent" as const }];
		const { devices } = await plan({
			hosted: { devices: [listedDevice("laptop", { profiles })] },
		});
		expect(await devices.profilesOf?.("laptop")).toEqual(profiles);
		expect(await devices.profilesOf?.("nowhere")).toBeNull();
		expect([...((await devices.lastKnown?.("laptop")) ?? [])]).toHaveLength(1);
	});

	test("the name of a Device: the Space's, the paired one's, or none", async () => {
		const { devices } = await plan({
			paired: [LAPTOP],
			deviceNames: { gone: "Gone" },
		});
		expect(await devices.deviceName?.("gone")).toBe("Gone");
		expect(await devices.deviceName?.("laptop")).toBe("Laptop");
		expect(await devices.deviceName?.("nowhere")).toBeNull();
	});

	test("a Device the Host lists with no Offers is another Person's", async () => {
		const devices = [listedDevice("theirs", { offers: [] })];
		await expect(byId({ hosted: { devices } }, "theirs")).rejects.toThrow(
			"theirs is not your device. It offers nothing to this Space.",
		);
	});

	test("the last resorts, the Device of the latest run first", async () => {
		const { devices } = await plan(
			{
				paired: [
					LAPTOP,
					pairedDevice("off"),
					pairedDevice("dev", { dev: true }),
				],
				online: ["laptop", "dev"],
			},
			OWNER,
			{ lastRun: "laptop" },
		);
		expect(await devices.lastResort?.()).toEqual(["laptop", WALKER]);
	});

	test("who picked the Device", async () => {
		expect((await plan()).byPerson).toBe(true);
		expect((await plan({}, OWNER, { byPerson: false })).byPerson).toBe(false);
	});
});

describe("a refusal of another Person's run on this computer", () => {
	const refusal = (
		world: PlacementWorld = {},
		group: Parameters<typeof offeredGroup>[0] = {},
	) => plan({ personal: SPACE, groups: offeredGroup(group), ...world }, GUEST);
	const NOTHING = "It offers nothing to this Space.";

	test("names the owner of the Host in the starter's Personal it keeps", async () => {
		const names = { [OWNER]: "Olivia" };
		await expect(refusal({ names })).rejects.toThrow(
			"The Host This computer belongs to Olivia.",
		);
		for (const world of [{ selfOwner: null }, { names: { [OWNER]: "" } }]) {
			await expect(refusal(world)).rejects.toThrow(
				"The Host This computer belongs to another person.",
			);
		}
	});

	test("does not outside that Personal, in a Space another Host keeps, or on another Device", async () => {
		await expect(refusal({ personal: "other" })).rejects.toThrow(NOTHING);
		await expect(refusal({ hosted: {} })).rejects.toThrow(NOTHING);
		await expect(refusal({}, { thisDevice: false })).rejects.toThrow(NOTHING);
	});

	test("says the role first when it does not use Offers", async () => {
		const offered = { deviceName: "This computer", offers: [], mayUse: false };
		await expect(refusal({}, { offered })).rejects.toThrow(
			"your role in this Space does not let you use",
		);
	});

	test("checks every group of nodes, also after one that passes", async () => {
		const groups: PlacementWorld["groups"] = (devices) => {
			const [group] = offeredGroup()(devices);
			return group ? [{ ...group, nodes: [] }, group] : [];
		};
		await expect(plan({ groups }, GUEST)).rejects.toThrow(NOTHING);
	});

	test("says which nodes an offered Device does not take", async () => {
		const offered = {
			deviceName: "This computer",
			offers: [
				{
					profile: "p-coder",
					profileName: "coder",
					permissionCap: "auto" as const,
				},
			],
			mayUse: true,
		};
		await expect(refusal({}, { offered })).rejects.toThrow(
			'It runs only Agent nodes with a profile its owner offers to this Space, not "run".',
		);
	});
});

describe("the calls of the ports", () => {
	const world: PlacementWorld = {
		hosted: { devices: [listedDevice("laptop"), listedDevice("other")] },
		copies: [deviceCopy("laptop")],
	};

	test("a plan asks for no list when no node needs one", async () => {
		expect((await plan(world)).calls).toEqual([
			...["personInSpace", "hostOf"],
			...["selfOwnerId", "personInSpace", "hostOf"],
		]);
	});

	test("a plan asks the Host for its list once, for all that the walk asks", async () => {
		const { devices, calls } = await plan(world);
		await Promise.all([
			devices.byId("laptop"),
			devices.nodeDevice("other"),
			devices.profilesOf?.("laptop"),
			devices.lastResort?.(),
		]);
		await devices.nodeDevice("laptop");
		expect(calls.filter((call) => call === "host")).toEqual(["host"]);
	});
});
