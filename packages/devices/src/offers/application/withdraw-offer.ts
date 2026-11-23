import type {
	DeviceOffers,
	Memberships,
	OfferAbort,
	SpaceOffers,
} from "./ports";

export type WithdrawOfferPorts = {
	deviceOffers: DeviceOffers;
	spaceOffers: Pick<SpaceOffers, "withdraw">;
	memberships: Pick<Memberships, "personInSpace">;
	abort: OfferAbort;
	self: { id: string };
};

export type WithdrawOffer = { spaceId: string; profile: string };

/**
 * Withdraws an Offer: own entry first, then the Space, then abort running
 * calls under it (also when the Host cannot be reached).
 */
export const withdrawOffer =
	(ports: WithdrawOfferPorts) =>
	async (input: WithdrawOffer, by: string): Promise<void> => {
		await ports.deviceOffers.remove(input.spaceId, input.profile);
		try {
			await ports.spaceOffers.withdraw({
				...input,
				deviceId: ports.self.id,
				by: await ports.memberships.personInSpace(input.spaceId, by),
			});
		} finally {
			ports.abort.withdrawn(input.spaceId, input.profile);
		}
	};
