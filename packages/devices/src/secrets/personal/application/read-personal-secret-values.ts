import type { HostCalls } from "../../calls";
import type { PersonalSecretStore } from "../../kept";
import { OLDER_HOST_SECRETS } from "../domain/personal-secrets";

export type ReadPersonalSecretValuesPorts = {
	store: Pick<PersonalSecretStore, "values">;
	calls: Pick<HostCalls, "home" | "ask">;
	/** The Person who owns this computer: whose secrets it keeps without a Home Host. */
	ownerId: string;
	deadlineMs: number;
};

/** The names a use asks for. */
export type ReadPersonalSecretValues = { names: readonly string[] };

/**
 * Gives the values of the owner's Personal secrets of these names: at
 * their Home Host when this computer has one, else from its own store.
 * No name asks nothing.
 *
 * Night Shift asks for a use: the use case takes the request alone.
 */
export const readPersonalSecretValues =
	(ports: ReadPersonalSecretValuesPorts) =>
	async (
		request: ReadPersonalSecretValues,
	): Promise<Record<string, string>> => {
		const { names } = request;
		if (names.length === 0) return {};
		const home = await ports.calls.home();
		if (!home) return ports.store.values(ports.ownerId, names);
		return ports.calls.ask(
			home.hostId,
			(client) => client.secrets.values({ names: [...names] }),
			{ deadlineMs: ports.deadlineMs, olderHost: OLDER_HOST_SECRETS },
		);
	};
