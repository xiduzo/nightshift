import type { DeviceStore } from "./ports";

export type ListHomePersonsPorts = { store: Pick<DeviceStore, "homePersons"> };

/**
 * The Persons whose home Host this computer is: each has a paired Device
 * with access that joined it as its home Host. Only a Host has such rows.
 *
 * The Offers ask it: the use case takes no request.
 */
export const listHomePersons =
	(ports: ListHomePersonsPorts) => async (): Promise<string[]> =>
		ports.store.homePersons();
