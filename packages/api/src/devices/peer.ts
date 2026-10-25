import { hostRouter } from "@nightshift/devices";

import { o } from "../procedures";
import { hostPhones } from "./phones";

/**
 * What a paired Device calls on this Host (`link`, `pairing`, `sync`,
 * `archive`, the work relay under `devices`): the peer protocol, served
 * by `@nightshift/devices` (`hostRouter`) and mounted here at its paths.
 * The API gives it what the router needs from beside `devices`: the
 * phones of a Person, from the notifier.
 */
export const hostPeer = o
	.use(({ context, next }) =>
		next({ context: { phones: hostPhones(context.notifications) } }),
	)
	.router(hostRouter);
