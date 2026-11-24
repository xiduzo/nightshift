import type { HostCalls } from "../../calls";
import type { PersonalSecretStore } from "../../kept";

export type RemovePersonalSecretPorts = {
	store: Pick<PersonalSecretStore, "remove">;
	calls: Pick<HostCalls, "home" | "ask">;
	/** The Person who owns this computer: whose secrets it keeps without a Home Host. */
	ownerId: string;
	deadlineMs: number;
};

/** The secret to remove. */
export type RemovePersonalSecret = { name: string };

/**
 * Removes one of the owner's Personal secrets: at their Home Host when
 * this computer has one, else from its own store.
 *
 * Night Shift asks for its owner: the use case takes the request alone.
 */
export const removePersonalSecret =
	(ports: RemovePersonalSecretPorts) =>
	async (request: RemovePersonalSecret): Promise<void> => {
		const { name } = request;
		const home = await ports.calls.home();
		if (!home) return ports.store.remove(ports.ownerId, name);
		return ports.calls.ask(
			home.hostId,
			(client) => client.secrets.remove({ name }),
			{ deadlineMs: ports.deadlineMs },
		);
	};
