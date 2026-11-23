import type { Role } from "@nightshift/auth";
import type { RunSummary } from "@nightshift/engine";
import type { OfferCaps } from "../../contract";
import type {
	DeviceOffer,
	DeviceOfferEntry,
	SpaceOffer,
} from "../domain/offers";

/**
 * The driven ports of offers. Another slice or package fills each one
 * (`@filledBy`). Twins live in `adapters/out/in-memory-neighbours.ts`.
 * DeviceOffers is this slice's own: its adapters are in `adapters/out/`.
 */

/** This computer's own Offers in its Device document. */
export type DeviceOffers = {
	list(nameOf: (profile: string) => string | null): DeviceOffer[];
	set(entry: DeviceOfferEntry): Promise<void>;
	remove(spaceId: string, profile: string): Promise<void>;
};

/**
 * The Offers published in Space documents, and the runs they stop.
 * @filledBy engine/wire
 */
export type SpaceOffers = {
	list(spaceId: string): Promise<SpaceOffer[]>;
	publish(
		offer: OfferCaps & {
			spaceId: string;
			profile: string;
			profileName: string;
			deviceId: string;
			deviceName: string;
			by: string | null;
		},
	): Promise<void>;
	withdraw(input: {
		spaceId: string;
		profile: string;
		deviceId: string;
		by: string | null;
	}): Promise<void>;
};

/**
 * Spaces, roles and names a Person sees when making Offers.
 * @filledBy auth
 */
export type Memberships = {
	spacesOf(
		personId: string,
	): Promise<{ id: string; name: string; personal: boolean; role: Role }[]>;
	roleAllows(role: Role, need: { offer: ("make" | "use")[] }): boolean;
	personNames(ids: readonly string[]): Promise<Map<string, string>>;
	personalSpaceIdBySlug(personId: string): Promise<string | null>;
	personInSpace(spaceId: string, personId: string): Promise<string | null>;
};

/**
 * Agent Profiles on this computer.
 * @filledBy engine/device-config
 */
export type Profiles = {
	get(id: string): { id: string; name: string } | null;
	byName(name: string): { id: string; name: string } | null;
	/**
	 * The profile when it is an agent profile, else null. Non-agent
	 * profiles (Decision / Value) cannot be offered.
	 */
	agent(id: string): { id: string; name: string } | null;
};

/**
 * Paired Devices and home Persons, as Offers list Space Devices.
 * @filledBy devices/registry
 */
export type Registry = {
	get(id: string): Promise<{
		id: string;
		ownerId: string;
		platform: string | null;
		lastSeenAt: number | null;
		revokedAt: number | null;
		online: boolean;
	} | null>;
	homePersons(): Promise<string[]>;
};

/**
 * Which Host keeps a Space (null when this computer keeps it).
 * @filledBy devices/links
 */
export type HostSpaces = {
	hostOf(spaceId: string): Promise<string | null>;
};

/**
 * Runs and projects of a Space, as the Offers page lists them.
 * @filledBy engine/wire
 */
export type SpaceReads = {
	listRuns(spaceId: string): Promise<
		{
			id: string;
			title: string;
			status: RunSummary["status"];
			device: { id: string };
			startedBy: { id: string; name: string | null } | null;
			createdAt: number;
		}[]
	>;
	listProjects(spaceId: string): Promise<
		{
			id: string;
			name: string;
			clones: {
				deviceId: string;
				deviceName: string | null;
				thisDevice: boolean;
			}[];
		}[]
	>;
	memberName(spaceId: string, personId: string): Promise<string | null>;
};

/**
 * Aborts calls running here under a withdrawn Offer.
 * @filledBy devices/wire
 */
export type OfferAbort = {
	withdrawn(spaceId: string, profile: string): void;
};
