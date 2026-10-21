import type { HostRole } from "./host-links";
import type { ListedSpace } from "./host-spaces";

/** What a Device and its Host say over its Link, and how pairing goes. */

export type LinkStatus = "connecting" | "online" | "offline" | "revoked";

/** A Host this computer paired with. */
export type LinkedHost = {
	hostId: string;
	name: string;
	role: HostRole;
	addresses: string[];
	/** The address that answers now. */
	address: string | null;
	status: LinkStatus;
	/** Epoch ms of the last change of `status`. */
	since: number;
	fingerprint: string | null;
};

/** What a paired Device learns from its Host when its link answers. */
export type HostHello = {
	host: { id: string; name: string; addresses: string[] };
	deviceId: string;
	personId: string;
	/** The Spaces the Device's owner is a Member of on the Host, with their role there. */
	spaces: ListedSpace[];
};

/** The Host's answer to a joining Device's poll. */
export type PairingRedeemed =
	| { status: "pending" | "slow-down" | "denied" | "expired" }
	| {
			status: "joined";
			key: string;
			personId: string;
			host: HostHello["host"];
	  };

/** How `nightshift join` goes, step by step. */
export type JoinProgress =
	| {
			kind: "code";
			userCode: string;
			/**
			 * The Host's page where the Person enters the code, and the same
			 * page with the code filled in. Null when this computer cannot
			 * open it: the Host names its own `localhost`.
			 */
			verificationUri: string | null;
			verificationUriComplete: string | null;
			/** The fingerprint of the Host's self-signed certificate, pinned on approval. */
			fingerprint: string | null;
			expiresAt: number;
	  }
	| { kind: "joined"; hostId: string; hostName: string; role: HostRole };

/** A pairing code for a joining Device, and where its Person approves it. */
export type PairingStart = {
	deviceCode: string;
	userCode: string;
	/** The page of the Host where the Person enters the code. */
	verificationUri: string;
	/** The same page with the code filled in. */
	verificationUriComplete: string;
	expiresIn: number;
	interval: number;
	/** The SHA-256 fingerprint of the certificate the Host serves itself, if any. */
	fingerprint: string | null;
};
