import type { ApiQueryUtils } from "../api";

/** How often the Devices page reads this computer, its Hosts and the paired Devices again. */
const OVERVIEW_POLL_MS = 5_000;
/** How often the Devices of the Space are read again. */
const SPACE_POLL_MS = 10_000;
/** How often a list of Offers is read again. */
const OFFERS_POLL_MS = 10_000;

/** The query options of Devices, and how often they poll. */
export function createDeviceQueries(orpc: ApiQueryUtils) {
	return {
		/** Every query of the Devices overview. Invalidate it after a Device or a Host changes. */
		overviewKey: () => orpc.devices.list.key(),
		/** This computer, its Hosts, and the person's paired Devices, once. */
		overview: () => orpc.devices.list.queryOptions(),
		/** This computer, its Hosts, and the person's paired Devices. Polls; a failed background poll keeps the page. */
		overviewLive: () => ({
			...orpc.devices.list.queryOptions(),
			refetchInterval: OVERVIEW_POLL_MS,
			meta: { quietRefetchErrors: true },
		}),
		/** Every query of your phones. Invalidate it after one signs out. */
		phonesKey: () => orpc.devices.phones.key(),
		/** Your phones on the Host of the active Space. Polls; a failed background poll keeps the list. */
		phonesLive: () => ({
			...orpc.devices.phones.queryOptions(),
			refetchInterval: SPACE_POLL_MS,
			meta: { quietRefetchErrors: true },
		}),
		/** The Devices of the active Space and their Offers. Polls; a failed background poll keeps the list. */
		spaceLive: () => ({
			...orpc.devices.space.queryOptions(),
			refetchInterval: SPACE_POLL_MS,
			meta: { quietRefetchErrors: true },
		}),
	};
}

/** The mutation options of Devices and pairing. */
export function createDeviceMutations(orpc: ApiQueryUtils) {
	return {
		review: orpc.devices.review.mutationOptions,
		approve: orpc.devices.approve.mutationOptions,
		deny: orpc.devices.deny.mutationOptions,
		revoke: orpc.devices.revoke.mutationOptions,
		removePhone: orpc.devices.removePhone.mutationOptions,
	};
}

/** The query options of Offers, and how often they poll. */
export function createOfferQueries(orpc: ApiQueryUtils) {
	return {
		/** Every offers query. Invalidate it after an Offer is made or withdrawn. */
		all: () => orpc.offers.key(),
		/** The Offers of this computer, and the Spaces it can offer to. */
		list: () => orpc.offers.list.queryOptions(),
		/** The Offers of this computer. Polls; a failed background poll keeps the list. */
		listLive: () => ({
			...orpc.offers.list.queryOptions(),
			refetchInterval: OFFERS_POLL_MS,
			meta: { quietRefetchErrors: true },
		}),
	};
}

/** The mutation options of Offers. */
export function createOfferMutations(orpc: ApiQueryUtils) {
	return {
		make: orpc.offers.make.mutationOptions,
		withdraw: orpc.offers.withdraw.mutationOptions,
	};
}
