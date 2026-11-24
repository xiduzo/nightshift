/**
 * The query options of Devices, pairing and Offers, and how often they
 * poll (`@nightshift/client`, on this app's client), and the mutations of
 * Devices. The Agents page makes and withdraws Offers, with the mutations
 * of agents.
 *
 * The Devices page shows what runs on each computer. The runs vertical
 * imports devices, so devices reads the runs here, on the same cache.
 */

import {
	createDeviceQueries,
	createOfferQueries,
	createRunQueries,
	createSettingsQueries,
} from "@nightshift/client";

import { orpc } from "@/shared/api";

/** This computer's settings: Devices reads and saves its Host addresses. */
export const settingsQueries = createSettingsQueries(orpc);

/** Saves a patch of the settings. */
export const settingsMutations = {
	save: settingsQueries.save,
};

export const deviceQueries = createDeviceQueries(orpc);

export const deviceMutations = {
	review: orpc.devices.review.mutationOptions,
	approve: orpc.devices.approve.mutationOptions,
	deny: orpc.devices.deny.mutationOptions,
	revoke: orpc.devices.revoke.mutationOptions,
	forget: orpc.devices.forget.mutationOptions,
	removePhone: orpc.devices.removePhone.mutationOptions,
};

export const offerQueries = createOfferQueries(orpc);

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
