import type { Actor } from "@nightshift/engine";
import { type PushTargetView, targetView } from "../domain/push-targets";
import type { listTargets } from "./list-targets";

export type ListScreensPorts = {
	/** The slice's own list of a Person's targets: it forgets the ended phones. */
	listTargets: ReturnType<typeof listTargets>;
};

/** Whose screens. */
export type ListScreens = { personId: string };

/**
 * The browsers, phones and desktop apps that get the Person's
 * notifications, as the Person sees them: no endpoint, no keys. Who asks:
 * the Person, for their own. No role applies.
 */
export const listScreens =
	(ports: ListScreensPorts) =>
	async (_actor: Actor, request: ListScreens): Promise<PushTargetView[]> =>
		(await ports.listTargets({ personId: request.personId })).map(targetView);
