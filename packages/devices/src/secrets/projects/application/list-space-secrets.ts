import type { HostCalls } from "../../calls";
import type { SpaceSecretStore } from "../../kept";
import {
	atKeeper,
	type NamedSecret,
	namedSecrets,
	settersOf,
	spaceAccess,
} from "../domain/project-secrets";
import type { KeeperSpaces, Members, RoleRules } from "./ports";

export type ListSpaceSecretsPorts = {
	spaces: KeeperSpaces;
	members: Pick<Members, "roleIn" | "names">;
	rules: RoleRules;
	spaceStore: Pick<SpaceSecretStore, "list">;
	calls: Pick<HostCalls, "ask">;
	/** The Person who owns this computer: the only one who acts through its key. */
	ownerId: string;
	/** How long one call of the Host may take. */
	deadlineMs: number;
};

/** The Space, the Person who asks, and the secret. */
export type ListSpaceSecrets = { spaceId: string; personId: string };

/**
 * Lists the names of a Space's secrets for a person (ADR 18), with who set each and when, never a value.
 *
 * In a Space this computer keeps (as its Host, or without one): here,
 * after the checks, from its own records. In a Space a Host keeps: at
 * that Host, with this Device's key, for this computer's owner only.
 *
 * Night Shift asks for a person: the use case takes the request alone.
 */
export const listSpaceSecrets =
	(ports: ListSpaceSecretsPorts) =>
	async (request: ListSpaceSecrets): Promise<NamedSecret[]> => {
		const { spaceId, personId } = request;
		return atKeeper(
			await ports.spaces.hostOf(spaceId),
			{ personId, ownerId: ports.ownerId },
			async () => {
				await spaceAccess(
					ports.spaces.hostOf,
					spaceId,
					{ roleIn: (id) => ports.members.roleIn(personId, id), saves: false },
					ports.rules,
				);
				const kept = await ports.spaceStore.list(spaceId);
				return namedSecrets(kept, await ports.members.names(settersOf(kept)));
			},
			(hostId) =>
				ports.calls.ask(
					hostId,
					(client) => client.spaceSecrets.list({ spaceId }),
					{
						deadlineMs: ports.deadlineMs,
					},
				),
		);
	};
