import type { PairingReviewView } from "../domain/host";
import { requireHost } from "../domain/host";
import type { PendingPairings } from "../domain/pending";
import { pendingByUserCode } from "../domain/pending";
import type { HostSettings, Pairings, PersonSpaces } from "./ports";

export type ReviewPairingPorts = {
	pairings: Pick<Pairings, "reviewPairing">;
	spaces: Pick<PersonSpaces, "isHostAdmin">;
	settings: Pick<HostSettings, "isHost">;
	pending: PendingPairings;
	fingerprint: string | null;
};

export type ReviewPairing = {
	headers: Headers;
	userCode: string;
	personId: string;
};

/**
 * Binds the code to the Person whose session the headers carry, and
 * shows the Device that waits with it.
 */
export const reviewPairing =
	(ports: ReviewPairingPorts) =>
	async (request: ReviewPairing): Promise<PairingReviewView> => {
		requireHost(ports.settings.isHost());
		const review = await ports.pairings.reviewPairing(
			request.headers,
			request.userCode,
		);
		const asked = pendingByUserCode(ports.pending, review.userCode);
		return {
			hostAdmin: await ports.spaces.isHostAdmin(request.personId),
			home: asked?.home ?? null,
			userCode: review.userCode,
			status: review.status,
			device: {
				id: review.deviceId,
				name: asked?.name ?? null,
				platform: asked?.platform ?? null,
			},
			fingerprint: ports.fingerprint,
		};
	};
