import type { DeviceKeyAccess } from "@nightshift/auth";
import type { DeviceCopy, KeyStoreKind } from "@nightshift/engine";
import type {
	HostHello,
	PairingRedeemed,
	PairingStart,
	PhoneView,
} from "../contract";
import type {
	HostRole,
	HostSpaceRef,
	JoinProgress,
	LinkedHost,
} from "../links";
import type { PairedDevice } from "../registry";

/** This computer's Devices, as the API serves them: as a Host (pairing, presence) and its links to Hosts. */

/** What the Devices page shows, for one Person. */
export type DevicesOverview = {
	/** This computer, for its owner. Null for another Person. */
	thisComputer: {
		id: string;
		name: string;
		platform: string;
		/** Where its Device keys are: the keychain, else a file only its user can read. */
		keyStore: KeyStoreKind;
		host: {
			/** "Be a Host" is on. */
			enabled: boolean;
			/** In the order Devices try them. */
			addresses: string[];
			/** Whom this computer answers now: itself only, or the network. */
			reachable: "this-computer" | "network";
			/** The settings ask for another reach than it has: a restart applies them. */
			restartNeeded: boolean;
			/** The SHA-256 fingerprint of the certificate it serves itself, if any. */
			fingerprint: string | null;
		};
		/** Its home Host and guest Hosts, each with the Spaces it keeps for this computer. */
		hosts: (LinkedHost & { spaces: HostSpaceRef[] })[];
	} | null;
	/** The Person's Devices paired with this computer, when it is a Host. */
	devices: PairedDevice[];
};

/**
 * One of the owner's other Devices, as this computer knows it from that
 * Device's document: read-only here. On a Host, the Devices whose home it
 * is; on a Device, the copies its home Host syncs. Secret names, never
 * their values.
 */
export type OtherDeviceView = Omit<DeviceCopy, "deviceId" | "name"> & {
	id: string;
	name: string;
	/** Its Link answers this Host now. Null: this computer cannot tell. */
	online: boolean | null;
};

/** A pairing code, as the Person approving it sees it. */
export type PairingReviewView = {
	userCode: string;
	/** The Person who reviews it is the Host admin. */
	hostAdmin: boolean;
	/** The Device asks this Host to be its home Host. Null: an older Device did not say. */
	home: boolean | null;
	status: "pending" | "approved" | "denied";
	device: { id: string; name: string | null; platform: string | null };
	/** This Host's certificate fingerprint, to compare with the one the device shows. */
	fingerprint: string | null;
};

export type Devices = {
	overview(input: {
		personId: string;
		owner: boolean;
	}): Promise<DevicesOverview>;
	/** A joining Device asks for a pairing code. Only a Host answers. */
	startPairing(input: {
		deviceId: string;
		name: string;
		platform: string;
		/** This Host is to be the Device's home Host. */
		home?: boolean;
	}): Promise<PairingStart>;
	/** A joining Device polls for the answer; on approval it gets its key. */
	redeemPairing(input: {
		deviceCode: string;
		deviceId: string;
		/** This Host is to be the Device's home Host. */
		home: boolean;
		/** The address the Device joined by. */
		address: string;
	}): Promise<PairingRedeemed>;
	/** Binds the code to the Person whose session `headers` carry (`personId`), and shows it. */
	review(
		headers: Headers,
		userCode: string,
		personId: string,
	): Promise<PairingReviewView>;
	approve(headers: Headers, userCode: string): Promise<void>;
	deny(headers: Headers, userCode: string): Promise<void>;
	/** Removes a Device's access: its key, its connections. The Person's own Devices only. */
	revoke(personId: string, deviceId: string): Promise<void>;
	/** A paired Device's link answered. */
	hello(key: DeviceKeyAccess): Promise<HostHello>;
	/** The owner's other Devices, from their documents: their profiles and secret names. */
	others(ownerId: string): Promise<OtherDeviceView[]>;
	/** The Host this computer joined that keeps the Space, or null for a Space it keeps itself. */
	hostOf(spaceId: string): Promise<string | null>;
	/** The phones of this computer's owner on a Host it joined. */
	phonesAt(hostId: string): Promise<PhoneView[]>;
	/** Signs out one of those phones. */
	removePhoneAt(hostId: string, phoneId: string): Promise<void>;
	/** Pairs this computer with a Host, step by step (`nightshift join`). */
	join(
		input: { url: string; role: HostRole },
		signal?: AbortSignal,
	): AsyncIterable<JoinProgress>;
};
