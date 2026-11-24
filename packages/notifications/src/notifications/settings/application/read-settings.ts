import type { PersonActor } from "@nightshift/engine";
import type { NotificationSettings } from "../domain/notification-settings";
import type { findSettings } from "./find-settings";

export type ReadSettingsPorts = {
	/** The slice's own read of a Person's settings. */
	findSettings: ReturnType<typeof findSettings>;
};

/**
 * The notification settings of the Person who asks. They belong to the
 * Person, not to a Space: no role applies, and nobody reads another's.
 */
export const readSettings =
	(ports: ReadSettingsPorts) =>
	async (actor: PersonActor): Promise<NotificationSettings> =>
		ports.findSettings({ personId: actor.personId });
