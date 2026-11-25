import type {
	Device,
	DeviceProfile,
	OwnDevice,
	PeerProjects,
	PlacedRun,
	PlanDevices,
	PlanInput,
	PlannedRun,
} from "@nightshift/engine";
import type { DeviceCopy } from "@nightshift/engine/settings";
import type { Refusal } from "@nightshift/refusal";
import type { WorkFor } from "../../../contract";
import type { DeviceOffer, spaceOffers } from "../../offers";

/**
 * The driven ports of placement. Neighbour ports are `@filledBy`; the
 * composition of the package passes them to `wirePlacement`. The registry
 * is a slice of this package, so a use case names it itself.
 */

/**
 * This computer.
 * @filledBy devices/wire
 */
export type ThisComputer = {
	device: Device;
	/** Its id as the Walker of the runs it walks. */
	walkerId(): Promise<string>;
	/** It as a run reaches it: through its Offers, for another Person's run. */
	deviceFor(run: PlacedRun): Device;
	/** "Be a Host" is on here. */
	isHost(): boolean;
	/** The profiles its owner may use. Null: unknown. */
	ownProfiles(): readonly DeviceProfile[] | null;
	/** Its Offers into a Space that are in force. */
	offersHere(spaceId: string): Promise<readonly DeviceOffer[]>;
};

/**
 * The Spaces: which Host keeps one, and what its document says.
 * @filledBy devices/wire
 */
export type Spaces = {
	/** The Host that keeps the Space, or null for a Space of this Replica's own. */
	hostOf(spaceId: string): Promise<string | null>;
	/** The Offers its document lists, every Device's, and the names it has of Devices. */
	open(spaceId: string): Promise<{
		offers(): ReturnType<typeof spaceOffers>;
		deviceName(deviceId: string): string | null;
	}>;
};

/**
 * Person and Space facts Placement needs from auth and links.
 * @filledBy auth
 */
export type SpacePeople = {
	/** The Person as the Space's Host knows them. Null in, when nobody is known, may come back null. */
	personInSpace<P extends string | null>(
		spaceId: string,
		personId: P,
	): Promise<string | P>;
	/** The Person who owns this computer, as the Space's Host knows them. */
	ownerIn(spaceId: string): Promise<string | null>;
	personalSpaceIdBySlug(personId: string): Promise<string | null>;
	/** A Person's name, or null when it is not known. It may be empty. */
	personName(personId: string): Promise<string | null>;
	keptByHomeHost(spaceId: string): Promise<boolean>;
	/** The Person's role in the Space uses Offers. */
	mayUseOffers(spaceId: string, personId: string): Promise<boolean>;
};

/**
 * The Projects of a Space and their Clones.
 * @filledBy engine/projects
 */
export type SpaceProjects = Pick<PeerProjects, "find" | "clones">;

/**
 * What this Replica keeps of the documents of other Devices.
 * @filledBy engine/settings
 */
export type DeviceCopies = {
	/** The copies of the owner's other Devices. */
	list(): Promise<DeviceCopy[]>;
	/** The document a Host keeps of a Device, or null. */
	kept(deviceId: string): Promise<DeviceCopy | null>;
};

/**
 * The Devices of the Person, as the Host that keeps a Space lists them.
 */
export type HostDevices = {
	/** Null while the Host cannot be reached. A refusal of the Host is thrown. Empty on a computer without Links. */
	list(project: {
		spaceId: string;
		projectId: string;
	}): Promise<OwnDevice[] | null>;
};

/**
 * The way to the other Devices.
 * @filledBy devices/wire
 */
export type OtherDevices = {
	/** False on a computer that reaches no other Device. */
	reaches: boolean;
	/** Whether a Device takes work now, for a run of that Space. */
	online(deviceId: string, spaceId: string): boolean | Promise<boolean>;
	/** A Device as a run reaches it. */
	at(device: { id: string; name: string }, forRun: WorkFor): Device;
	/** A Device that nothing is sent to: it refuses each call of a run with no starter. */
	withoutStarter(device: { id: string; name: string }, forRun: WorkFor): Device;
};

/**
 * The engine's plan of a run over the Devices it may use.
 * @filledBy engine/wire
 */
export type RunPlanner = Required<
	Pick<PlanDevices, "profileFor" | "lastKnown" | "flows">
> & {
	planNodes(
		start: PlanInput["start"],
		devices: PlanDevices,
		personId: string | null,
		byPerson: boolean,
	): Promise<PlannedRun>;
	/** The refusal of a Device this computer cannot reach: the engine's, so a plan says it in one way. */
	unreachable(): Refusal;
};
