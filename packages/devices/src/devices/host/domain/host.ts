import { type OtherVersion, Refusal } from "@nightshift/refusal";
import { NOT_A_HOST } from "../../../contract";

/** This computer must be a Host now. Else the Device keeps its key. */
export function requireHost(isHost: boolean): void {
	if (!isHost) throw new Refusal("unavailable", NOT_A_HOST);
}

/** A pairing code, as the Person approving it sees it. */
export type PairingReviewView = {
	userCode: string;
	/** The Person who reviews it is the Host admin. */
	hostAdmin: boolean;
	/** The Device asks this Host to be its home Host. Null: this Host started again since. */
	home: boolean | null;
	status: "pending" | "approved" | "denied";
	device: { id: string; name: string | null; platform: string | null };
	/** This Host's certificate fingerprint, to compare with the one the device shows. */
	fingerprint: string | null;
};

/**
 * The Devices that last called with another version than this Host's (ADR
 * 45), for the Devices page: such a Device is offline, and an old one
 * cannot say why itself. In memory: each tries again within minutes.
 */
export type DeviceVersions = {
	/** A Device called. Null: its version is this Host's. */
	said(deviceId: string, version: OtherVersion | null): void;
	/** How the version of the Device's last call compares. Null: the same, or it did not call. */
	of(deviceId: string): OtherVersion | null;
};

export function createDeviceVersions(): DeviceVersions {
	const others = new Map<string, OtherVersion>();
	return {
		said(deviceId, version) {
			if (version) others.set(deviceId, version);
			else others.delete(deviceId);
		},
		of: (deviceId) => others.get(deviceId) ?? null,
	};
}
