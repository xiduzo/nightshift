import type {
	DeviceProfile,
	OwnDevice,
	PlacedDevice,
	PlacedRun,
	PlanDevices,
	PlannedRun,
} from "@nightshift/engine";
import type { DeviceCopy } from "@nightshift/engine/settings";
import { FLOW_VERSION, type Flow } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import { asDate } from "@nightshift/time";
import type { WorkFor, WorkRelay } from "../../../../contract";
import { remoteDevice } from "../../../../work";
import type { DeviceRegistry, PairedDevice } from "../../../registry";
import type {
	DeviceCopies,
	OtherDevices,
	RunPlanner,
	SpacePeople,
	SpaceProjects,
	Spaces,
	ThisComputer,
} from "../../application/ports";
import { inMemoryHostDevices } from "./in-memory-host-devices";

export const SPACE = "space-1";
export const PROJECT = "project-1";
export const OWNER = "owner";
export const GUEST = "guest";
/** This computer: its Device id, and the id of its Walker. */
export const SELF = "self";
export const WALKER = "walker";
export const HOST = "host-1";

export const FLOW: Flow = {
	version: FLOW_VERSION,
	inputs: [],
	outputs: [],
	start: "run",
	nodes: [
		{
			id: "run",
			type: "command",
			command: "true",
			position: { x: 0, y: 0 },
			stdout: "text",
		},
	],
	edges: [],
};

/** What a test says of the world of placement. Absent: an empty world, with this computer alone in it. */
export type PlacementWorld = {
	paired?: PairedDevice[];
	/** The Devices that take work now. Default: every paired one. */
	online?: string[];
	/** What the Host that keeps the Space lists. Absent: this computer keeps it. */
	hosted?: Parameters<typeof inMemoryHostDevices>[0];
	keptByHome?: boolean;
	/** The profiles that Devices publish into the Space, by Device. */
	offering?: Record<string, string[]>;
	/** The profiles that this computer offers. */
	offersHere?: string[];
	mayUse?: boolean;
	isHost?: boolean;
	/** False: this computer reaches no other Device. */
	reaches?: boolean;
	ownProfiles?: DeviceProfile[];
	copies?: DeviceCopy[];
	kept?: DeviceCopy[];
	folder?: boolean;
	repoPath?: string | null;
	/** The Devices with a Clone. Default: the paired and the offering ones. */
	clones?: string[];
	/** The personal Space of every Person. */
	personal?: string;
	/** The names of Persons. Default: each id. */
	names?: Record<string, string>;
	/** The Person ids the Host of the Space gives for the ones known here. */
	known?: Record<string, string>;
	selfOwner?: string | null;
	/** The names the Space's document has of Devices. */
	deviceNames?: Record<string, string>;
	groups?: (devices: PlanDevices) => PlannedRun["groups"];
};

/** A Device as the Host of the Space lists it. */
export const listedDevice = (
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

/** A Device that paired with this computer, of its owner. */
export const pairedDevice = (
	id: string,
	more: Partial<PairedDevice> = {},
): PairedDevice => ({
	id,
	name: id,
	platform: "darwin",
	ownerId: OWNER,
	homeHost: null,
	lastSeenAt: null,
	online: true,
	pairedAt: 0,
	revokedAt: null,
	...more,
});

/** A copy of a Device's document. */
export const deviceCopy = (
	deviceId: string,
	more: Partial<DeviceCopy> = {},
): DeviceCopy => ({
	deviceId,
	name: deviceId,
	platform: null,
	profiles: [{ id: `p-${deviceId}`, name: "copied", kind: "agent" }],
	secrets: [],
	checkedAt: null,
	...more,
});

/** A run of the owner that this computer walks. */
export const placedRun = (
	plan: Partial<PlacedRun["plan"]> = {},
): PlacedRun => ({
	id: "run-1",
	spaceId: SPACE,
	projectId: PROJECT,
	walkerId: WALKER,
	plan: {
		device: { id: WALKER, name: "This computer" },
		devices: {},
		personId: OWNER,
		...plan,
	},
});

/** The ports of placement in memory, typed by them. `calls` names each call, in order. */
export function inMemoryPlacement(world: PlacementWorld = {}) {
	const calls: string[] = [];
	/** The Devices a run reached, and whether it has a starter. */
	const reached: { id: string; forRun: WorkFor; starter: boolean }[] = [];
	const planned: {
		devices: PlanDevices;
		personId: string | null;
		byPerson: boolean;
	}[] = [];
	const paired = world.paired ?? [];
	const offering = Object.entries(world.offering ?? {});
	const online = new Set(world.online ?? paired.map((d) => d.id));
	const selfOwner = world.selfOwner === undefined ? OWNER : world.selfOwner;
	const said = <T>(name: string, value: T): T => {
		calls.push(name);
		return value;
	};

	/** A work relay that no test sends a call over. */
	const relay: WorkRelay = { async *call() {}, online: () => false };
	const runAt = {
		spaceId: SPACE,
		projectId: PROJECT,
		personId: OWNER,
		runId: "run-1",
	};
	const device = (name: string) =>
		remoteDevice(relay, { id: SELF, name }, runAt);

	const here: ThisComputer = {
		device: device("This computer"),
		walkerId: async () => said("walkerId", WALKER),
		deviceFor: (run) => device(`This computer for ${run.id}`),
		isHost: () => world.isHost ?? false,
		ownProfiles: () => world.ownProfiles ?? null,
		offersHere: async (spaceId) =>
			said(
				"offersHere",
				(world.offersHere ?? []).map((name) => ({
					spaceId,
					profile: `p-${name}`,
					profileName: name,
					permissionCap: "auto" as const,
					sessionCap: 1,
					offeredAt: 1,
				})),
			),
	};
	const spaces: Spaces = {
		hostOf: async () => said("hostOf", world.hosted ? HOST : null),
		open: async () =>
			said("open", {
				offers: () =>
					offering.flatMap(([deviceId, profiles]) =>
						profiles.map((name) => ({
							deviceId,
							deviceName: `published ${deviceId}`,
							profile: `p-${name}`,
							profileName: name,
							permissionCap: "auto" as const,
							sessionCap: 1,
							offeredAt: 1,
							by: null,
						})),
					),
				deviceName: (id: string) => world.deviceNames?.[id] ?? null,
			}),
	};
	const people: SpacePeople = {
		personInSpace: async (_space, id) =>
			said("personInSpace", (id !== null && world.known?.[id]) || id),
		ownerIn: async () => {
			calls.push("selfOwnerId");
			return said(
				"personInSpace",
				(selfOwner !== null && world.known?.[selfOwner]) || selfOwner,
			);
		},
		personalSpaceIdBySlug: async () => world.personal ?? null,
		personName: async (id) => world.names?.[id] ?? id,
		keptByHomeHost: async () =>
			said("keptByHomeHost", world.keptByHome ?? true),
		mayUseOffers: async () => said("mayUseOffers", world.mayUse ?? false),
	};
	const registry: Pick<DeviceRegistry, "selfOwnerId" | "list" | "get"> = {
		selfOwnerId: async () => said("selfOwnerId", selfOwner),
		list: async (person) =>
			said(
				"list",
				paired.filter((d) => d.ownerId === person),
			),
		get: async (id) => said("get", paired.find((d) => d.id === id) ?? null),
	};
	const projects: SpaceProjects = {
		find: async (id) =>
			said("find", {
				id,
				spaceId: SPACE,
				name: "Project",
				remote: null,
				folder: world.folder ?? true,
				createdAt: asDate(0),
				removedAt: null,
				repoPath: world.repoPath === undefined ? "/repo" : world.repoPath,
			}),
		clones: async (_space, projectId) =>
			said(
				"clones",
				(
					world.clones ?? [
						...paired.map((d) => d.id),
						...offering.map(([id]) => id),
					]
				).map((deviceId) => ({ projectId, deviceId, deviceName: deviceId })),
			),
	};
	const copies: DeviceCopies = {
		list: async () => said("copies", world.copies ?? []),
		kept: async (id) =>
			said("kept", world.kept?.find((c) => c.deviceId === id) ?? null),
	};
	const listing = inMemoryHostDevices(world.hosted ?? {});
	const host: typeof listing = {
		list: (project) => said("host", listing.list(project)),
	};
	const others: OtherDevices = {
		reaches: world.reaches ?? true,
		online: (id) => said("online", online.has(id)),
		at(at, forRun) {
			reached.push({ id: at.id, forRun, starter: true });
			return remoteDevice(relay, at, forRun);
		},
		withoutStarter(at, forRun) {
			reached.push({ id: at.id, forRun, starter: false });
			return remoteDevice(relay, at, forRun);
		},
	};
	const planner: RunPlanner = {
		unreachable: () => new Refusal("invalid", "unreachable"),
		profileFor: () => null,
		lastKnown: async () =>
			new Map([
				[
					"p-last",
					{
						name: "last",
						settings: {
							harness: "claude-code",
							model: "m",
							permissionMode: "auto",
							clis: [],
							connections: [],
						},
					},
				],
			]),
		flows: async () => ({}),
		async planNodes(_start, devices, personId, byPerson) {
			planned.push({ devices, personId, byPerson });
			return {
				plan: {
					device: { id: SELF, name: "This computer" },
					devices: {},
					personId,
				},
				notes: [],
				run: devices.walker,
				flow: FLOW,
				flowName: null,
				flowRevision: null,
				calledFlows: {},
				calledFlowRevisions: {},
				groups: world.groups?.(devices) ?? [],
			};
		},
	};
	const ports = {
		here,
		spaces,
		people,
		registry,
		projects,
		copies,
		host,
		others,
		planner,
	};
	return { ports, calls, reached, planned };
}

/** The nodes of a flow on this computer, for another Person's run. */
export const offeredGroup =
	(more: Partial<PlacedDevice> = {}) =>
	(devices: PlanDevices): PlannedRun["groups"] => [
		{
			at: {
				...devices.walker,
				offered: { deviceName: "This computer", offers: [], mayUse: true },
				...more,
			},
			nodes: FLOW.nodes,
		},
	];
