import type { HostCalls } from "../../calls";
import type { SpaceSecretStore } from "../../kept";
import {
	atKeeper,
	OLDER_HOST_PROJECT_SECRETS,
	spaceAccess,
} from "../domain/project-secrets";
import type { KeeperSpaces, Members, RoleRules } from "./ports";

export type SaveSpaceSecretPorts = {
	spaces: KeeperSpaces;
	members: Pick<Members, "roleIn">;
	rules: RoleRules;
	spaceStore: Pick<SpaceSecretStore, "set">;
	calls: Pick<HostCalls, "ask">;
	/** The Person who owns this computer: the only one who acts through its key. */
	ownerId: string;
	/** How long one call of the Host may take. */
	deadlineMs: number;
};

/** The Space, the Person who asks, and the secret. */
export type SaveSpaceSecret = {
	spaceId: string;
	name: string;
	value: string;
	personId: string;
};

/**
 * Saves or replaces a Space secret (ADR 18) for a person whose role saves Flows.
 *
 * In a Space this computer keeps (as its Host, or without one): here,
 * after the checks, from its own records. In a Space a Host keeps: at
 * that Host, with this Device's key, for this computer's owner only.
 *
 * Night Shift asks for a person: the use case takes the request alone.
 */
export const saveSpaceSecret =
	(ports: SaveSpaceSecretPorts) =>
	async (request: SaveSpaceSecret): Promise<void> => {
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
				return ports.spaceStore.set(
					spaceId,
					request.name,
					request.value,
					personId,
				);
			},
			(hostId) =>
				ports.calls.ask(
					hostId,
					(client) =>
						client.spaceSecrets.set({
							spaceId,
							name: request.name,
							value: request.value,
						}),
					{
						deadlineMs: ports.deadlineMs,
						olderHost: OLDER_HOST_PROJECT_SECRETS,
					},
				),
		);
	};
