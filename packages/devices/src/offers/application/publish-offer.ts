import type { HostRelay, OfferCaps } from "../../contract";
import { type SpaceOffer, publishOffer as writeOffer } from "../domain/offers";

/** An Offer as the Space document receives it, before `offeredAt`. */
export type PublishOfferInput = OfferCaps & {
	spaceId: string;
	deviceId: string;
	deviceName: string;
	/** The profile's id. */
	profile: string;
	profileName: string;
	by: string | null;
};

type OfferDocument = {
	offers: { set(key: string, value: unknown): unknown };
	change(fn: () => void): Promise<void>;
};

export type PublishOfferPorts = {
	/** Every method waits for the engine to be ready. */
	ready: Promise<unknown>;
	open(spaceId: string): Promise<OfferDocument>;
	/** The Host that keeps the Space, or null for a Space of this Replica's own. */
	hostOf(spaceId: string): Promise<string | null>;
	deviceId: string;
	now(): number;
	relay?: Pick<HostRelay, "offer">;
	logMade(spaceId: string, offer: SpaceOffer): Promise<void>;
	/** The Host cannot publish this Offer. */
	unreachable(): never;
};

/**
 * Publishes an Offer (or its new caps) in the Space's document and logs
 * it there. A Space a Host keeps: through that Host.
 */
export const publishOffer =
	(ports: PublishOfferPorts) =>
	async (input: PublishOfferInput): Promise<void> => {
		await ports.ready;
		const { spaceId, by, ...offer } = input;
		if ((await ports.hostOf(spaceId)) !== null) {
			if (!ports.relay || offer.deviceId !== ports.deviceId) {
				ports.unreachable();
			}
			await ports.relay.offer({
				spaceId,
				profile: offer.profile,
				profileName: offer.profileName,
				deviceName: offer.deviceName,
				permissionCap: offer.permissionCap,
				sessionCap: offer.sessionCap,
			});
			return;
		}
		const document = await ports.open(spaceId);
		const written = { ...offer, offeredAt: ports.now(), by };
		await document.change(() => writeOffer(document, written));
		await ports.logMade(spaceId, written);
	};
