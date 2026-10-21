/** What a Device and its Host say over its Link, and how pairing goes. */

/** A Space as a Host lists it to a Device. */
export type ListedSpace = {
	id: string;
	name: string;
	personal: boolean;
	/** The role of the Device's owner there. */
	role: string;
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
