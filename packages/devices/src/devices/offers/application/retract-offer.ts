import type { HostRelay } from "../../../contract";
import type { OfferRef } from "../domain/offered-sessions";
import { type OfferDocument, unpublishOffer } from "../domain/offers";

export type RetractOfferInput = {
	spaceId: string;
	deviceId: string;
	/** The profile's id. */
	profile: string;
	by: string | null;
};

export type RetractOfferPorts = {
	ready: Promise<unknown>;
	open(spaceId: string): Promise<OfferDocument>;
	hostOf(spaceId: string): Promise<string | null>;
	deviceId: string;
	relay?: Pick<HostRelay, "withdrawOffer">;
	logWithdrawn(input: RetractOfferInput): Promise<void>;
	/** Stops the runs walked here whose running step is a session under the Offer. */
	stopUnder(offer: OfferRef): Promise<void>;
	unreachable(): never;
};

/**
 * Takes an Offer off the Space's document, logs it, and stops the runs
 * walked here whose running step is a session under it. A Space a Host
 * keeps: through that Host, and the runs walked here stop also when it
 * cannot be reached. Nothing to withdraw is no error.
 */
export const retractOffer =
	(ports: RetractOfferPorts) =>
	async (input: RetractOfferInput): Promise<void> => {
		await ports.ready;
		const { spaceId, deviceId, profile, by } = input;
		const stop = { spaceId, deviceId, profile };
		if ((await ports.hostOf(spaceId)) !== null) {
			if (!ports.relay || deviceId !== ports.deviceId) {
				ports.unreachable();
			}
			try {
				await ports.relay.withdrawOffer({ spaceId, profile });
			} finally {
				// The runs this computer walks stop their steps under it too,
				// also when the Host cannot be reached.
				await ports.stopUnder(stop);
			}
			return;
		}
		const document = await ports.open(spaceId);
		let removed = false;
		await document.change(() => {
			removed = unpublishOffer(document, deviceId, profile);
		});
		if (removed) await ports.logWithdrawn({ spaceId, deviceId, profile, by });
		await ports.stopUnder(stop);
	};
