import { wireSpaces } from "@nightshift/auth";
import type { Database } from "@nightshift/db";
import {
	deviceNameIn,
	type PeerContext,
	type Peers,
	planNodes,
	UNREACHABLE_DEVICE,
} from "@nightshift/engine";
import type { HostRelay, WorkRelay } from "../../contract";
import { type HostSpaces, keptByHomeHost, personInSpace } from "../../links";
import { remoteDevice } from "../../work";
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
import { UNREACHABLE } from "./domain/no-relay";

/** What the composition gives placement. */
export type PlacementDeps = ThisComputer & {
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
	const { db, documents, hostSpaces, profiles, work } = deps;
	const spaces = wireSpaces({ db });
	const ports: PlanRunPorts & { here: ThisComputer } = {
		here: deps,
		spaces: {
			hostOf: (spaceId) => hostSpaces.hostOf(spaceId),
			open: async (spaceId) => {
				const document = await documents.open(spaceId);
				return {
					offers: document.offers,
					deviceName: (id) => deviceNameIn(document, id),
				};
			},
		},
		people: {
			personInSpace: (spaceId, personId) =>
				personInSpace(db, spaceId, personId),
			personalSpaceIdBySlug: (personId) =>
				spaces.personal.findPersonalSpaceBySlug({ personId }),
			personNames: (ids) => spaces.members.listPersonNames({ ids }),
			keptByHomeHost: (spaceId) => keptByHomeHost(db, spaceId),
			mayUseOffers: deps.mayUseOffers,
		},
		registry: deps.registry,
		projects: deps.projects,
		copies: deps.copies,
		host: relayHostDevices(deps.relay),
		others: {
			relay: work ?? UNREACHABLE,
			reaches: work !== null,
			over: (relay, device, forRun) => remoteDevice(relay, device, forRun),
		},
		planner: {
			planNodes,
			unreachable: UNREACHABLE_DEVICE,
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
