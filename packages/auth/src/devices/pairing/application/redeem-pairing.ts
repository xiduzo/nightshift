import { type PairingAnswer, waitingAnswer } from "../domain/pairing";
import type { DeviceAuthorizations } from "./ports";

export type RedeemPairingPorts = {
	deviceAuthorizations: Pick<
		DeviceAuthorizations,
		"poll" | "personOfToken" | "forgetToken"
	>;
};

/** The Device's code, and the Device. */
export type RedeemPairing = { deviceCode: string; deviceId: string };

/**
 * The answer to the Device's code so far. The device code is used up on
 * approval. The plugin's session token is deleted the moment it is made:
 * the Device learns only who approved.
 */
export const redeemPairing =
	(ports: RedeemPairingPorts) =>
	async (request: RedeemPairing): Promise<PairingAnswer> => {
		const port = ports.deviceAuthorizations;
		const answer = await port.poll(request);
		if (!("token" in answer)) return waitingAnswer(answer.error);
		const personId = await port.personOfToken(answer.token);
		await port.forgetToken(answer.token);
		if (!personId) throw new Error("The pairing ended without a person.");
		return { status: "approved", personId };
	};
