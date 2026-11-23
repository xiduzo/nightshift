/**
 * Shapes of a pairing code as Better Auth returns them to this Host.
 * The Pairings port carries them; the domain owns the shapes.
 */

/** A pairing code the Device polls with. */
export type PairingCode = {
	deviceCode: string;
	userCode: string;
	expiresIn: number;
	interval: number;
};

/** The answer to the Device's poll, before this Host gives it a key. */
export type PairingAnswer =
	| { status: "pending" }
	| { status: "slow-down" }
	| { status: "denied" }
	| { status: "expired" }
	| { status: "approved"; personId: string };

/** A pairing code as the Person who reviews it sees it. */
export type PairingReview = {
	userCode: string;
	status: "pending" | "approved" | "denied";
	deviceId: string;
};
