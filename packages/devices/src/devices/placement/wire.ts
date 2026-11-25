import { wireSpaces } from "@nightshift/auth";
import type { Database } from "@nightshift/db";
import {
	deviceNameIn,
	type PeerContext,
	type Peers,
	planNodes,
	UNREACHABLE_DEVICE,
} from "@nightshift/engine";
import { Refusal } from "@nightshift/refusal";
import type { HostRelay, WorkRelay } from "../../contract";
import { type HostSpaces, keptByHomeHost, personInSpace } from "../../links";
import { remoteDevice } from "../../work";
import { spaceOffers } from "../offers";
import type { DeviceRegistry } from "../registry";
import { relayHostDevices } from "./adapters/out/relay-host-devices";
import { findMoveTarget } from "./application/find-move-target";
import { listPlacements } from "./application/list-placements";
import { listRunDevices } from "./application/list-run-devices";
import { type PlanRunPorts, planRun } from "./application/plan-run";
import type {
	DeviceCopies,
	SpacePeople,
	ThisComputer,
} from "./application/ports";
import { reachDevice } from "./application/reach-device";
import { NO_STARTER_RELAY, UNREACHABLE } from "./domain/no-relay";

/** What the composition gives placement. */
export type PlacementDeps = {
	here: ThisComputer;
	db: Database;
	registry: Pick<DeviceRegistry, "selfOwnerId" | "list" | "get">;
	documents: Pick<PeerContext["documents"], "open">;
	hostSpaces: Pick<HostSpaces, "hostOf">;
	projects: PlanRunPorts["projects"];
	profiles: PeerContext["profiles"];
	flows: PeerContext["flows"];
	copies: DeviceCopies;
	mayUseOffers: SpacePeople["mayUseOffers"];
	/** How steps reach other Devices. Null: every run runs on this computer. */
	work: WorkRelay | null;
	/** The Hosts this computer links to. Null: none. */
	relay: Pick<HostRelay, "devices"> | null;
};

/**
 * The wiring of placement: which Device a step runs on, and which of a
 * Person's Devices a run may use.
 */
export function wirePlacement(deps: PlacementDeps): Peers["placement"] {
	const { db, documents, hostSpaces, profiles, registry } = deps;
	const work = deps.work ?? UNREACHABLE;
	const spaces = wireSpaces({ db });
	const ports: PlanRunPorts & Parameters<typeof reachDevice>[0] = {
		here: deps.here,
		spaces: {
			hostOf: (spaceId) => hostSpaces.hostOf(spaceId),
			open: async (spaceId) => {
				const document = await documents.open(spaceId);
				return {
					offers: () => spaceOffers(document),
					deviceName: (id) => deviceNameIn(document, id),
				};
			},
		},
		people: {
			personInSpace: (spaceId, personId) =>
				personInSpace(db, spaceId, personId),
			ownerIn: async (spaceId) =>
				personInSpace(db, spaceId, await registry.selfOwnerId()),
			personalSpaceIdBySlug: (personId) =>
				spaces.personal.findPersonalSpaceBySlug({ personId }),
			personName: async (id) =>
				(await spaces.members.listPersonNames({ ids: [id] })).get(id) ?? null,
			keptByHomeHost: (spaceId) => keptByHomeHost(db, spaceId),
			mayUseOffers: deps.mayUseOffers,
		},
		registry,
		projects: deps.projects,
		copies: deps.copies,
		host: relayHostDevices(deps.relay),
		others: {
			reaches: deps.work !== null,
			online: (id, spaceId) => work.online(id, spaceId),
			at: (device, forRun) => remoteDevice(work, device, forRun),
			withoutStarter: (device, forRun) =>
				remoteDevice(NO_STARTER_RELAY, device, forRun),
		},
		planner: {
			planNodes,
			unreachable: () => new Refusal("invalid", UNREACHABLE_DEVICE),
			profileFor: profiles.here,
			lastKnown: profiles.lastKnown,
			flows: deps.flows,
		},
	};
	return {
		plan: planRun(ports),
		deviceById: reachDevice(ports),
		moveTo: findMoveTarget(ports),
		devicesFor: listRunDevices(ports),
		placements: listPlacements(ports),
	};
}
