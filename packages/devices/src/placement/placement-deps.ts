import type { Database } from "@nightshift/db";
import type {
	Device,
	DeviceProfile,
	PeerProfiles,
	PeerProjects,
	PlacedRun,
} from "@nightshift/engine";
import type {
	DeviceCopies,
	DeviceCopy,
} from "@nightshift/engine/device-config";
import type { SpaceDocuments } from "@nightshift/engine/projects";
import type { FlowSources } from "@nightshift/flows";
import type { HostRelay, WorkRelay } from "../contract";
import type { HostSpaces } from "../links";
import type { DeviceOffer } from "../offers";
import type { DeviceRegistry } from "../registry";

/** What `createPlacement` (`placement.ts`) reads of this computer and its Replica. */

export type PlacementDeps = {
	db: Database;
	/** This computer as a Device. */
	device: Device;
	/** This computer as the Walker of its runs (`PeerContext.walkerId`). */
	walkerId(): Promise<string>;
	registry: DeviceRegistry;
	documents: SpaceDocuments;
	hostSpaces: HostSpaces;
	/** A project a person has not removed, with its Clone here or null, and the Devices with a Clone of it. */
	projects: Pick<PeerProjects, "find" | "clones">;
	/** The profiles of this computer and of the Devices this Replica knows. */
	profiles: Pick<PeerProfiles, "here" | "lastKnown">;
	/** What the Device document this Replica keeps of another Device says: its profiles. */
	keptDevice(deviceId: string): Promise<DeviceCopy | null>;
	/** The project's flows, from this Replica's flow document: what a run starts from. */
	flows(projectId: string): Promise<FlowSources>;
	/** How calls reach other Devices. Without it, every step runs here. */
	work?: WorkRelay;
	/** The Hosts this computer links to. */
	relay?: HostRelay;
	/**
	 * This computer for a step of a run: itself, or for another Person's
	 * run, itself through its Offer admission (`OfferAdmission.deviceFor`).
	 * Default: itself.
	 */
	localFor?(run: PlacedRun): Device;
	/** "Be a Host" is on here: this computer is the Host among the run's Devices. Default: no. */
	isHost?(): boolean;
	/** This computer's own Offers into a Space that are in force. Default: none. */
	offersHere?(spaceId: string): Promise<DeviceOffer[]>;
	/** This computer's profiles, for its owner. Default: unknown. */
	ownProfiles?(): readonly DeviceProfile[];
	/**
	 * The copies of the documents of this computer's owner's other Devices,
	 * from the home Host (`createDeviceCopies`). Default: none.
	 */
	copies?: Pick<DeviceCopies, "list">;
	/** Whether a Person's role in a Space uses Offers. Default: nobody's. */
	mayUseOffers?(spaceId: string, personId: string): Promise<boolean>;
};
