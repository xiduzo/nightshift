import type { HostPhones, PhoneView } from "@nightshift/devices";
import type { Notifications } from "@nightshift/notifications";
import { ORPCError } from "@orpc/server";

/**
 * A Person's phones on this computer: the Night Shift app signed in here,
 * with its notifications on. Only a Host has them: the phone app signs in
 * to a Host only. A Device asks its Host for them over its link.
 */

export async function phonesOf(
	notifications: Notifications,
	personId: string,
): Promise<PhoneView[]> {
	const targets = await notifications.targets.list(personId);
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

/** Signs out one of the Person's phones here. */
export async function removePhone(
	notifications: Notifications,
	personId: string,
	id: string,
): Promise<void> {
	const phones = await phonesOf(notifications, personId);
	if (!phones.some((phone) => phone.id === id)) {
		throw new ORPCError("NOT_FOUND", {
			message:
				"This phone is not in your list. Reload the page to see the list now.",
		});
	}
	await notifications.targets.remove(personId, id);
}

/** A Person's phones here, as the Host's router reads them for a paired Device's link. */
export function hostPhones(notifications: Notifications): HostPhones {
	return {
		list: (personId) => phonesOf(notifications, personId),
		remove: (personId, id) => removePhone(notifications, personId, id),
	};
}
