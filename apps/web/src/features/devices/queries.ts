/**
 * The query options of Devices, pairing and Offers, and how often they
 * poll (`@nightshift/client`, on this app's client), and their mutations.
 *
 * The Agents page makes and withdraws Offers. The agents vertical sits
 * below devices, so it imports this file through a peer port
 * (`scripts/check-verticals.ts`).
 *
 * The Devices page shows what runs on each computer. The runs vertical
 * imports devices, so devices reads the runs here, on the same cache.
 */

import {
	createDeviceQueries,
	createOfferQueries,
	createRunQueries,
} from "@nightshift/client";

import { orpc } from "@/shared/api";

export const deviceQueries = createDeviceQueries(orpc);

export const deviceMutations = {
	review: orpc.devices.review.mutationOptions,
	approve: orpc.devices.approve.mutationOptions,
	deny: orpc.devices.deny.mutationOptions,
	revoke: orpc.devices.revoke.mutationOptions,
	removePhone: orpc.devices.removePhone.mutationOptions,
};

export const offerQueries = createOfferQueries(orpc);

export const offerMutations = {
	make: orpc.offers.make.mutationOptions,
	withdraw: orpc.offers.withdraw.mutationOptions,
};

/** The Space's runs, to show what runs on each computer now. */
export const runQueries = createRunQueries(orpc);

/**
 * The merge of this computer's Personal into its home Host's: whether it
 * waits for the person, and what it would do. Web only.
 */
export const mergeQueries = {
	pending: () => orpc.devices.merge.pending.queryOptions(),
	preview: (join: readonly string[]) =>
		orpc.devices.merge.preview.queryOptions({ input: { join: [...join] } }),
	run: () => orpc.devices.merge.run.mutationOptions(),
};

/** Leaving the home Host: this computer keeps a Personal of its own. Web only. */
export const leaveMutation = () => orpc.devices.leave.mutationOptions();
