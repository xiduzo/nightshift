import type { HostCalls } from "../../calls";
import type { SpaceSecretStore } from "../../kept";
import {
	atKeeper,
	OLDER_HOST_PROJECT_SECRETS,
	spaceAccess,
} from "../domain/project-secrets";
import type { KeeperSpaces, Members, RoleRules } from "./ports";

export type TakeSpaceSecretPorts = {
	spaces: KeeperSpaces;
	members: Pick<Members, "roleIn">;
	rules: RoleRules;
	spaceStore: Pick<SpaceSecretStore, "values">;
	calls: Pick<HostCalls, "ask">;
	/** The Person who owns this computer: the only one who acts through its key. */
	ownerId: string;
	/** How long one call of the Host may take. */
	deadlineMs: number;
};

/** The Space, the Person who asks, and the secret. */
export type TakeSpaceSecret = {
	spaceId: string;
	name: string;
	personId: string;
};

/**
 * Reads a Space secret (ADR 18) for a move, for a person whose role saves Flows. Null: none of that name.
 *
 * In a Space this computer keeps (as its Host, or without one): here,
 * after the checks, from its own records. In a Space a Host keeps: at
 * that Host, with this Device's key, for this computer's owner only.
 *
 * Night Shift asks for a person: the use case takes the request alone.
 */
export const takeSpaceSecret =
	(ports: TakeSpaceSecretPorts) =>
	async (request: TakeSpaceSecret): Promise<string | null> => {
		const { spaceId, personId } = request;
		return atKeeper(
			await ports.spaces.hostOf(spaceId),
			{ personId, ownerId: ports.ownerId },
			async () => {
				await spaceAccess(
					ports.spaces.hostOf,
					spaceId,
					{ roleIn: (id) => ports.members.roleIn(personId, id), saves: true },
					ports.rules,
				);
				return (
					(await ports.spaceStore.values(spaceId, [request.name]))[
						request.name
					] ?? null
				);
			},
			(hostId) =>
				ports.calls.ask(
					hostId,
					(client) => client.spaceSecrets.take({ spaceId, name: request.name }),
					{
						deadlineMs: ports.deadlineMs,
						olderHost: OLDER_HOST_PROJECT_SECRETS,
					},
				),
		);
	};
