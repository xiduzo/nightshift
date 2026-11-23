import { Refusal } from "@nightshift/refusal";
import { NOT_A_HOST } from "../../contract";

/** This computer must be a Host now. Else the Device keeps its key. */
export function requireHost(isHost: boolean): void {
	if (!isHost) throw new Refusal("unavailable", NOT_A_HOST);
}

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
