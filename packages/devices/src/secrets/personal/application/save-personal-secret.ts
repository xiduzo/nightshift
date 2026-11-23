import type { HostCalls } from "../../calls";
import type { PersonalSecretStore } from "../../kept";
import { OLDER_HOST_SECRETS } from "../domain/personal-secrets";

export type SavePersonalSecretPorts = {
	store: Pick<PersonalSecretStore, "set">;
	calls: Pick<HostCalls, "home" | "ask">;
	/** The Person who owns this computer: whose secrets it keeps without a Home Host. */
	ownerId: string;
	/** This computer's Device: the one that set a value it keeps itself. */
	selfId: string;
	deadlineMs: number;
};

/** The secret to save. */
export type SavePersonalSecret = { name: string; value: string };

/**
 * Saves or replaces one of the owner's Personal secrets: at their Home
 * Host when this computer has one, else in its own store.
 *
 * Night Shift asks for its owner: the use case takes the request alone.
 */
export const savePersonalSecret =
	(ports: SavePersonalSecretPorts) =>
	async (request: SavePersonalSecret): Promise<void> => {
		const { name, value } = request;
		const home = await ports.calls.home();
		if (!home) {
			return ports.store.set(ports.ownerId, name, value, ports.selfId);
		}
		return ports.calls.ask(
			home.hostId,
			(client) => client.secrets.set({ name, value }),
			{ deadlineMs: ports.deadlineMs, olderHost: OLDER_HOST_SECRETS },
		);
	};
