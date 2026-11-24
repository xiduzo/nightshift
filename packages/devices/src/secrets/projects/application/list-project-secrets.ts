import type { HostCalls } from "../../calls";
import type { ProjectSecretStore } from "../../kept";
import {
	atKeeper,
	type NamedSecret,
	namedSecrets,
	type ProjectAt,
	projectAccess,
	settersOf,
} from "../domain/project-secrets";
import type { EnginePlaces, KeeperSpaces, Members, RoleRules } from "./ports";

export type ListProjectSecretsPorts = {
	spaces: KeeperSpaces;
	places: Pick<EnginePlaces, "spaceOf">;
	members: Pick<Members, "roleIn" | "names">;
	rules: RoleRules;
	store: Pick<ProjectSecretStore, "list">;
	calls: Pick<HostCalls, "ask">;
	/** The Person who owns this computer: the only one who acts through its key. */
	ownerId: string;
	/** How long one call of the Host may take. */
	deadlineMs: number;
};

/** The Project, the Person who asks, and the secret. */
export type ListProjectSecrets = { project: ProjectAt; personId: string };

/**
 * Lists the names of a Project's secrets for a person, with who set each and when, never a value.
 *
 * In a Space this computer keeps (as its Host, or without one): here,
 * after the checks, from its own records. In a Space a Host keeps: at
 * that Host, with this Device's key, for this computer's owner only.
 *
 * Night Shift asks for a person: the use case takes the request alone.
 */
export const listProjectSecrets =
	(ports: ListProjectSecretsPorts) =>
	async (request: ListProjectSecrets): Promise<NamedSecret[]> => {
		const { project: at, personId } = request;
		return atKeeper(
			await ports.spaces.hostOf(at.spaceId),
			{ personId, ownerId: ports.ownerId },
			async () => {
				await projectAccess(
					ports.places.spaceOf,
					ports.spaces.hostOf,
					at,
					{
						roleIn: (spaceId) => ports.members.roleIn(personId, spaceId),
						saves: false,
					},
					ports.rules,
				);
				const kept = await ports.store.list(at.projectId);
				return namedSecrets(kept, await ports.members.names(settersOf(kept)));
			},
			(hostId) =>
				ports.calls.ask(hostId, (client) => client.projectSecrets.list(at), {
					deadlineMs: ports.deadlineMs,
				}),
		);
	};
