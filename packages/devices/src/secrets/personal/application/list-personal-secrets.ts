import type { PersonalSecretName } from "../../../contract";
import type { HostCalls } from "../../calls";
import type { PersonalSecretStore } from "../../kept";
import { OLDER_HOST_SECRETS } from "../domain/personal-secrets";

export type ListPersonalSecretsPorts = {
	store: Pick<PersonalSecretStore, "list">;
	calls: Pick<HostCalls, "home" | "ask">;
	/** The Person who owns this computer: whose secrets it keeps without a Home Host. */
	ownerId: string;
	deadlineMs: number;
};

/**
 * Lists the names of the owner's Personal secrets: at their Home Host
 * when this computer has one, else in its own store.
 *
 * Night Shift asks for its owner: the use case takes no request.
 */
export const listPersonalSecrets =
	(ports: ListPersonalSecretsPorts) =>
	async (): Promise<PersonalSecretName[]> => {
		const home = await ports.calls.home();
		if (!home) return ports.store.list(ports.ownerId);
		return ports.calls.ask(home.hostId, (client) => client.secrets.list(), {
			deadlineMs: ports.deadlineMs,
			olderHost: OLDER_HOST_SECRETS,
		});
	};
