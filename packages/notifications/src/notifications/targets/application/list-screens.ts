import type { PersonActor } from "@nightshift/engine";
import { type PushTargetView, targetView } from "../domain/push-targets";
import type { listTargets } from "./list-targets";

export type ListScreensPorts = {
	/** The slice's own list of a Person's targets: it forgets the ended phones. */
	listTargets: ReturnType<typeof listTargets>;
};

/**
 * The browsers, phones and desktop apps that get the notifications of the
 * Person who asks, as they see them: no endpoint, no keys. No role
 * applies, and nobody lists another's.
 */
export const listScreens =
	(ports: ListScreensPorts) =>
	async (actor: PersonActor): Promise<PushTargetView[]> =>
		(await ports.listTargets({ personId: actor.personId })).map(targetView);
