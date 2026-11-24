import type { HostPhones, PhoneView } from "@nightshift/devices";
import type { PersonActor } from "@nightshift/engine";
import type { Notifications } from "@nightshift/notifications";
import { Refusal } from "@nightshift/refusal";

/**
 * A Person's phones on this computer: the Night Shift app signed in here,
 * with its notifications on. Only a Host has them: the phone app signs in
 * to a Host only. A Device asks its Host for them over its link.
 */

export async function phonesOf(
	notifications: Notifications,
	actor: PersonActor,
): Promise<PhoneView[]> {
	const targets = await notifications.targets.list(actor);
	return targets
		.filter((target) => target.kind === "expo")
		.map(({ id, name, platform, createdAt, lastSeenAt }) => ({
			id,
			name,
			platform,
			createdAt,
			lastSeenAt,
		}));
}

/**
 * Signs out one of the Person's phones here. A phone that is not theirs
 * is a refusal (`not-found`): the API answers it with 404, and a Device's
 * Host sends it as a refusal with its kind, never as a NOT_FOUND, which a
 * Device reads as a Host that does not know the procedure.
 */
export async function removePhone(
	notifications: Notifications,
	actor: PersonActor,
	id: string,
): Promise<void> {
	const phones = await phonesOf(notifications, actor);
	if (!phones.some((phone) => phone.id === id)) {
		throw new Refusal(
			"not-found",
			"This phone is not in your list. Reload the page to see the list.",
		);
	}
	await notifications.targets.remove(actor, id);
}

/** A Person's phones here, as the Host's router reads them for a paired Device's link. */
export function hostPhones(notifications: Notifications): HostPhones {
	/** The Person of the Device's key. */
	const asked = (personId: string): PersonActor => ({
		personId,
		door: "device-key",
	});
	return {
		list: (personId) => phonesOf(notifications, asked(personId)),
		remove: (personId, id) => removePhone(notifications, asked(personId), id),
	};
}
