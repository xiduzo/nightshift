import type { HostRole } from "./host-links";

/** The Links of this computer to its Hosts, and how `nightshift join` goes. */

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
	| {
			kind: "joined";
			hostId: string;
			hostName: string;
			role: HostRole;
			/**
			 * This computer's owner is the Host admin there. When not, the Host
			 * admin can read their personal runs. Null: the Host did not say.
			 */
			hostAdmin: boolean | null;
	  };
