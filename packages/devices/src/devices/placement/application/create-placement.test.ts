import { describe, expect, test } from "bun:test";
import type {
	OwnDevice,
	PlacedRun,
	PlanDevices,
	PlanInput,
} from "@nightshift/engine";
import { Refusal } from "@nightshift/refusal";
import type { PairedDevice } from "../../registry";
import {
	inMemoryDeviceCopies,
	inMemorySpacePeople,
} from "../adapters/out/in-memory-neighbours";
import { createPlacement, type PlacementDeps } from "./create-placement";

const SPACE = "space-1";
const PROJECT = "project-1";
const OWNER = "owner";
const GUEST = "guest";
/** This computer: its Device id, and the id of its Walker. */
const SELF = "self";
const WALKER = "walker";
const HOST = "host-1";

class Unreachable extends Refusal {
	constructor() {
		super("unavailable", "no answer");
	}
}

type Paired = Pick<PairedDevice, "id" | "name" | "ownerId"> & {
	revokedAt?: number;
	dev?: boolean;
};

/** A Device as the Host of the Space lists it. */
const listed = (
	deviceId: string,
	more: Partial<OwnDevice> = {},
): OwnDevice => ({
	deviceId,
	name: deviceId,
	thisDevice: false,
	online: true,
	hasClone: true,
	...more,
});

/** Placement of a computer that keeps the Space, unless `hosted` lists what its Host tells. */
function placementWith(
	given: {
		paired?: Paired[];
		online?: string[];
		hosted?: () => Promise<OwnDevice[]>;
		/** The Devices that publish the profile "coder" into the Space. */
		offering?: string[];
		offersHere?: boolean;
		mayUse?: boolean;
		isHost?: boolean;
		work?: boolean;
		copyName?: string | null;
		personal?: string;
		groups?: unknown[];
		/** The Person ids the Host of the Space gives for the ones known here. */
		known?: Record<string, string>;
	} = {},
) {
	const paired = (given.paired ?? []).map(
		(d) => ({ revokedAt: null, dev: false, ...d }) as PairedDevice,
	);
	const online = new Set(given.online ?? paired.map((d) => d.id));
	const planned: { devices: PlanDevices; personId: string | null }[] = [];
	/** The calls of the ports, in order. */
	const calls: string[] = [];
	const said = <A extends unknown[], R>(
		name: string,
		call: (...args: A) => R,
	) => {
		return (...args: A): R => {
			calls.push(name);
			return call(...args);
		};
	};
	const offers = new Map(
		(given.offering ?? []).map((deviceId) => [
			deviceId,
			{
				deviceId,
				deviceName: `published ${deviceId}`,
				profile: "p-coder",
				profileName: "coder",
				permissionCap: "auto",
				sessionCap: 1,
				offeredAt: 1,
				by: null,
			},
		]),
	);
	const placement = createPlacement({
		device: { id: SELF, name: "This computer" },
		walkerId: said("walkerId", async () => WALKER),
		registry: {
			selfOwnerId: said("selfOwnerId", async () => OWNER),
			list: said("list", async (person: string) =>
				paired.filter((d) => d.ownerId === person),
			),
			get: said(
				"get",
				async (id: string) => paired.find((d) => d.id === id) ?? null,
			),
		},
		documents: { open: said("open", async () => ({ offers })) },
		hostSpaces: {
			hostOf: said("hostOf", async () => (given.hosted ? HOST : null)),
		},
		spacePeople: {
			...inMemorySpacePeople({
				personalId: given.personal ?? null,
				keptByHome: true,
			}),
			personInSpace: said(
				"personInSpace",
				async (_space: string, id: string | null) =>
					(id && given.known?.[id]) ?? id,
			),
			keptByHomeHost: said("keptByHomeHost", async () => true),
		},
		projects: {
			find: said("find", async () => ({ folder: true, repoPath: "/repo" })),
			clones: said("clones", async () =>
				[...paired.map((d) => d.id), ...(given.offering ?? [])].map(
					(deviceId) => ({ deviceId }),
				),
			),
		},
		profiles: { here: () => null, lastKnown: async () => null },
		keptDevice: said("keptDevice", async () => null),
		flows: async () => ({}),
		...(given.work === false
			? {}
			: { work: { online: said("online", (id: string) => online.has(id)) } }),
		...(given.hosted
			? { relay: { devices: said("devices", given.hosted) } }
			: {}),
		...(given.copyName !== undefined
			? {
					copies: inMemoryDeviceCopies([
						{
							deviceId: "laptop",
							name: given.copyName,
							profiles: [{ id: "p-copy", name: "copy", kind: "agent" }],
						} as never,
					]),
				}
			: {}),
		isHost: () => given.isHost ?? false,
		offersHere: said("offersHere", async () =>
			given.offersHere
				? [{ profile: "p-coder", profileName: "coder", permissionCap: "auto" }]
				: [],
		),
		mayUseOffers: said("mayUseOffers", async () => given.mayUse ?? false),
		engineFns: {
			planNodes: async (
				_start: unknown,
				devices: PlanDevices,
				personId: string | null,
			) => {
				planned.push({ devices, personId });
				return { groups: given.groups ?? [] };
			},
			deviceNameIn: () => "named in the Space",
			HostUnreachableError: Unreachable,
			UNREACHABLE_DEVICE: "unreachable",
			remoteDevice: (_relay: unknown, device: object) => device,
		},
	} as unknown as PlacementDeps);
	const list = (person = OWNER) => placement.devicesFor(SPACE, person, PROJECT);
	return {
		placement,
		calls,
		planned,
		list,
		ids: async (person?: string) => (await list(person)).map((d) => d.deviceId),
		/** Plans a run, and gives what its nodes are planned over. */
		async plan(startedBy: string | null = OWNER, more: object = {}) {
			await placement.plan({
				start: { startedBy },
				project: { id: PROJECT, spaceId: SPACE, folder: true, repoPath: "/r" },
				runId: "run-1",
				...more,
			} as unknown as PlanInput);
			const last = planned.at(-1);
			if (!last) throw new Error("Nothing planned.");
			return last;
		},
	};
}

const LAPTOP: Paired = { id: "laptop", name: "Laptop", ownerId: OWNER };
const THEIRS: Paired = { id: "theirs", name: "Theirs", ownerId: GUEST };

/** A step's Device group as the engine plans it on another Person's Device. */
const offeredGroup = (more: object) => ({
	at: {
		thisDevice: true,
		offered: { deviceName: "This computer", offers: [], mayUse: true },
		...more,
	},
	nodes: [{ id: "run", type: "command", command: "true" }],
});

describe("the Devices of a Person in a Space kept here", () => {
	test("are the paired ones with access, once each, and a development install says so", async () => {
		const devices = await placementWith({
			paired: [
				LAPTOP,
				{ ...LAPTOP, id: "dev", dev: true },
				{ ...LAPTOP, id: "removed", revokedAt: 1 },
				{ ...LAPTOP, id: WALKER },
			],
		}).list();
		expect(devices.map((d) => [d.deviceId, d.dev ?? false])).toEqual([
			[WALKER, false],
			["laptop", false],
			["dev", true],
		]);
	});

	test("then come the others that offer a profile: never this computer, the Person's own or a removed one", async () => {
		const devices = await placementWith({
			paired: [LAPTOP, THEIRS, { ...THEIRS, id: "removed", revokedAt: 1 }],
			online: [],
			offering: [SELF, WALKER, "laptop", "theirs", "removed"],
		}).list();
		expect(
			devices.slice(1).map((d) => [d.deviceId, d.offers, d.online]),
		).toEqual([
			["laptop", undefined, false],
			["theirs", ["coder"], false],
		]);
	});

	test("asked for the Person's own, no offered Device counts", async () => {
		const devices = await placementWith({
			paired: [THEIRS],
			offering: ["theirs"],
		}).placement.devicesFor(SPACE, OWNER, PROJECT, true);
		expect(devices.map((d) => d.deviceId)).toEqual([WALKER]);
	});

	test("a run can be placed on the ones online, and not on a development install", async () => {
		const { placement } = placementWith({
			paired: [
				LAPTOP,
				{ ...LAPTOP, id: "off" },
				{ ...LAPTOP, id: "dev", dev: true },
			],
			online: ["laptop", "dev"],
		});
		expect(
			(await placement.placements(SPACE, OWNER, PROJECT)).map(
				(p) => p.deviceId,
			),
		).toEqual([WALKER, "laptop"]);
	});
});

describe("the Devices of a Person in a Space a Host keeps", () => {
	test("are the Host's list without this computer, and an Offer lists none twice", async () => {
		const { ids } = placementWith({
			offering: ["laptop"],
			hosted: async () => [listed(WALKER), listed("laptop")],
		});
		expect(await ids()).toEqual([WALKER, "laptop"]);
	});

	test("a refusal of the Host stands", async () => {
		const { list } = placementWith({
			copyName: "Laptop",
			hosted: async () => {
				throw new Refusal("forbidden", "Not yours.");
			},
		});
		await expect(list()).rejects.toThrow("Not yours.");
	});

	test("while it does not answer, a copy without a name takes the one the Space knows", async () => {
		const devices = await placementWith({
			copyName: null,
			hosted: async () => {
				throw new Unreachable();
			},
		}).list();
		expect(devices[1]?.name).toBe("named in the Space");
	});

	test("the profiles of a copy never stand in for those of an offered Device", async () => {
		const devices = await placementWith({
			copyName: "Laptop",
			hosted: async () => [listed("laptop", { offers: ["coder"] })],
		}).list();
		expect(devices[1]?.profiles).toBeUndefined();
	});
});

describe("the Devices a run is planned over", () => {
	const byId = async (
		given: Parameters<typeof placementWith>[0],
		id: string,
		person?: string,
	) => (await placementWith(given).plan(person)).devices.byId(id);

	test("refuse a removed Device, and every other one without a relay", async () => {
		await expect(
			byId({ paired: [{ ...LAPTOP, revokedAt: 1 }] }, "laptop"),
		).rejects.toThrow("unreachable");
		await expect(
			byId({ paired: [LAPTOP], work: false }, "laptop"),
		).rejects.toThrow("unreachable");
	});

	test("refuse a Device that is not on the Host's list", async () => {
		await expect(byId({ hosted: async () => [] }, "laptop")).rejects.toThrow(
			"That device is not one of your devices on the Host of this Space.",
		);
	});

	test("carry the role of the starter with an offered Device, here and on the Host's list", async () => {
		for (const mayUse of [true, false]) {
			const given = { offering: ["theirs"], mayUse };
			const kept = await byId({ ...given, paired: [THEIRS] }, "theirs");
			const hosted = await byId(
				{
					...given,
					hosted: async () => [listed("theirs", { offers: ["coder"] })],
				},
				"theirs",
			);
			expect(kept?.offered).toMatchObject({ deviceName: "Theirs", mayUse });
			expect(hosted?.offered).toMatchObject({ deviceName: "theirs", mayUse });
		}
	});

	test("give this computer to another Person through its Offers, with their role", async () => {
		for (const mayUse of [true, false]) {
			const { devices } = await placementWith({
				offersHere: true,
				mayUse,
			}).plan(GUEST);
			expect(devices.walker.offered).toMatchObject({
				mayUse,
				offers: [{ profileName: "coder" }],
			});
		}
	});

	test("name the Host of the Space: it, this computer as a Host, or none", async () => {
		const named = async (given: Parameters<typeof placementWith>[0]) => {
			const { devices } = await placementWith(given).plan();
			return [devices.keeperId, devices.hostId];
		};
		const hosted = async () => [];
		expect(await named({ hosted, isHost: true })).toEqual([HOST, HOST]);
		expect(await named({ isHost: true })).toEqual([WALKER, WALKER]);
		expect(await named({})).toEqual([WALKER, undefined]);
	});

	test("tell the profiles of a listed Device", async () => {
		const profiles = [{ id: "p-1", name: "one", kind: "agent" as const }];
		const { devices } = await placementWith({
			hosted: async () => [listed("laptop", { profiles })],
		}).plan();
		expect(await devices.profilesOf?.("laptop")).toEqual(profiles);
		expect(await devices.profilesOf?.("nowhere")).toBeNull();
	});

	test("as a last resort, are the ones online, without a development install, the last one used first", async () => {
		const { devices } = await placementWith({
			paired: [
				LAPTOP,
				{ ...LAPTOP, id: "off" },
				{ ...LAPTOP, id: "dev", dev: true },
			],
			online: ["laptop", "dev"],
		}).plan(OWNER, { lastRun: "laptop" });
		expect(await devices.lastResort?.()).toEqual(["laptop", WALKER]);
	});
});

describe("the Person a run is planned for", () => {
	test("is the one a schedule names as it is, else the starter as the Host knows them", async () => {
		const run = placementWith({ known: { person: "on-host" } });
		expect((await run.plan("person", { scheduled: true })).personId).toBe(
			"person",
		);
		expect((await run.plan("person")).personId).toBe("on-host");
	});
});

describe("a refusal of another Person's run on this computer", () => {
	const refusal = (
		given: Parameters<typeof placementWith>[0],
		offered: object = {},
	) =>
		placementWith({
			personal: SPACE,
			groups: [offeredGroup(offered)],
			...given,
		}).plan(GUEST);

	test("names the owner of the Host in the starter's Personal it keeps", async () => {
		await expect(refusal({})).rejects.toThrow(
			`The Host This computer belongs to ${OWNER}.`,
		);
	});

	test("does not in a Space another Host keeps", async () => {
		await expect(refusal({ hosted: async () => [] })).rejects.toThrow(
			"It offers nothing to this Space.",
		);
	});

	test("says the role first when it does not use Offers", async () => {
		await expect(
			refusal(
				{},
				{ offered: { deviceName: "This computer", offers: [], mayUse: false } },
			),
		).rejects.toThrow("your role in this Space does not let you use");
	});
});

describe("a Device of the plan, and a move", () => {
	const run = {
		id: "run-1",
		spaceId: SPACE,
		projectId: PROJECT,
		walkerId: WALKER,
		plan: { personId: OWNER, devices: {} },
	} as unknown as PlacedRun;

	test("the Walker of the run is this computer", () => {
		expect(placementWith().placement.deviceById(WALKER, run)).toMatchObject({
			id: SELF,
		});
	});

	test("a move asks for the Devices of the Person as the Host knows them, never this computer", async () => {
		const { placement } = placementWith({
			paired: [{ ...LAPTOP, ownerId: "person-on-host" }],
			known: { person: "person-on-host" },
		});
		const actor = { personId: "person", door: "session" as const };
		expect(await placement.moveTo(run, actor, "laptop")).toEqual({
			id: "laptop",
			name: "Laptop",
		});
		expect(await placement.moveTo(run, actor, WALKER)).toBeNull();
	});
});

describe("the calls of the ports", () => {
	const listKept = [
		...["find", "walkerId", "hostOf", "clones", "list"],
		...["keptDevice", "online"],
		...["selfOwnerId", "personInSpace", "personInSpace"],
		...["find", "open", "clones", "walkerId", "get", "online"],
	];
	const listHosted = [
		...["find", "walkerId", "hostOf", "keptByHomeHost"],
		...["selfOwnerId", "personInSpace", "devices"],
		...["selfOwnerId", "personInSpace", "personInSpace"],
		...["find", "open", "clones", "walkerId"],
	];

	test("of a list of the Devices in a Space kept here", async () => {
		const run = placementWith({
			paired: [LAPTOP, THEIRS],
			offering: ["theirs"],
		});
		await run.list();
		expect(run.calls).toEqual(listKept);
	});

	test("of a list of the Devices in a Space a Host keeps", async () => {
		const run = placementWith({
			copyName: "Laptop",
			hosted: async () => [listed("laptop")],
		});
		await run.list();
		expect(run.calls).toEqual(listHosted);
	});

	test("of a plan ask the Host for its list once, and only when a Device is asked for", async () => {
		const run = placementWith({
			copyName: "Laptop",
			hosted: async () => [listed("laptop")],
		});
		const { devices } = await run.plan();
		expect(run.calls).toEqual([
			...["personInSpace", "hostOf", "selfOwnerId", "personInSpace", "hostOf"],
		]);
		run.calls.length = 0;
		await devices.profilesOf?.("laptop");
		expect(run.calls).toEqual(listHosted);
		await devices.profilesOf?.("laptop");
		await devices.lastResort?.();
		expect(run.calls).toEqual(listHosted);
	});

	test("of the walk of a plan ask the Host for its list once, at the same time too", async () => {
		const run = placementWith({
			copyName: "Laptop",
			hosted: async () => [listed("laptop"), listed("other")],
		});
		const { devices } = await run.plan();
		run.calls.length = 0;
		await Promise.all([devices.byId("laptop"), devices.nodeDevice("other")]);
		await devices.nodeDevice("laptop");
		expect(run.calls.filter((call) => call === "devices")).toHaveLength(1);
	});
});
