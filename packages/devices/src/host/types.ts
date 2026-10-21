import type { DeviceKeyAccess } from "@nightshift/auth";
import type { KeyStoreKind } from "@nightshift/engine";
import type { HostHello, PairingRedeemed, PairingStart } from "../contract";
import type { HostRole, JoinProgress, LinkedHost } from "../links";
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
		/** Its home Host and guest Hosts. */
		hosts: LinkedHost[];
	} | null;
	/** The Person's Devices paired with this computer, when it is a Host. */
	devices: PairedDevice[];
};

/** A pairing code, as the Person approving it sees it. */
export type PairingReviewView = {
	userCode: string;
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
	/** Binds the code to the Person whose session `headers` carry, and shows it. */
	review(headers: Headers, userCode: string): Promise<PairingReviewView>;
	approve(headers: Headers, userCode: string): Promise<void>;
	deny(headers: Headers, userCode: string): Promise<void>;
	/** Removes a Device's access: its key, its connections. The Person's own Devices only. */
	revoke(personId: string, deviceId: string): Promise<void>;
	/** A paired Device's link answered. */
	hello(key: DeviceKeyAccess): Promise<HostHello>;
	/** Pairs this computer with a Host, step by step (`nightshift join`). */
	join(
		input: { url: string; role: HostRole },
		signal?: AbortSignal,
	): AsyncIterable<JoinProgress>;
};
