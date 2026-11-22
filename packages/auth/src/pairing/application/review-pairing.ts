import { Refusal } from "@nightshift/refusal";
import {
	NOT_YOURS,
	normalizeUserCode,
	type PairingReview,
} from "../domain/pairing";
import type { DeviceAuthorizations } from "./ports";

export type ReviewPairingPorts = {
	deviceAuthorizations: Pick<DeviceAuthorizations, "verify">;
};

/** The Person's session (in the headers), and the code they typed. */
export type ReviewPairing = { headers: Headers; userCode: string };

/**
 * The code, for the Person whose session the headers carry. The first
 * Person who reviews a pending code holds it: for anyone else it is
 * refused.
 */
export const reviewPairing =
	(ports: ReviewPairingPorts) =>
	async (request: ReviewPairing): Promise<PairingReview> => {
		const code = normalizeUserCode(request.userCode);
		const review = await ports.deviceAuthorizations.verify(
			request.headers,
			code,
		);
		// The plugin names the client only to the Person who holds the code.
		if (!review.clientId) throw new Refusal("forbidden", NOT_YOURS);
		return {
			userCode: code,
			status: review.status as PairingReview["status"],
			deviceId: review.clientId,
		};
	};
