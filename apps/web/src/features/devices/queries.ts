/**
 * The query and mutation options of Devices, pairing and Offers, and how
 * often they poll (`@nightshift/client`, on this app's client).
 *
 * The Agents page makes and withdraws Offers. The agents vertical sits
 * below devices, so it imports this file through a peer port
 * (`scripts/check-verticals.ts`).
 */

import {
	createDeviceMutations,
	createDeviceQueries,
	createOfferMutations,
	createOfferQueries,
} from "@nightshift/client";

import { orpc } from "@/shared/api";

export const deviceQueries = createDeviceQueries(orpc);

export const deviceMutations = createDeviceMutations(orpc);

export const offerQueries = createOfferQueries(orpc);

export const offerMutations = createOfferMutations(orpc);
