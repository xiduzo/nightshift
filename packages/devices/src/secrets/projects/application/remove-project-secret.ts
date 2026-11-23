import type { HostCalls } from "../../calls";
import type { ProjectSecretStore } from "../../kept";
import {
	atKeeper,
	OLDER_HOST_PROJECT_SECRETS,
	type ProjectAt,
	projectAccess,
} from "../domain/project-secrets";
import type { EnginePlaces, KeeperSpaces, Members, RoleRules } from "./ports";

export type RemoveProjectSecretPorts = {
	spaces: KeeperSpaces;
	places: Pick<EnginePlaces, "spaceOf">;
	members: Pick<Members, "roleIn">;
	rules: RoleRules;
	store: Pick<ProjectSecretStore, "remove">;
	calls: Pick<HostCalls, "ask">;
	/** The Person who owns this computer: the only one who acts through its key. */
	ownerId: string;
	/** How long one call of the Host may take. */
	deadlineMs: number;
};

/** The Project, the Person who asks, and the secret. */
export type RemoveProjectSecret = {
	project: ProjectAt;
	name: string;
	personId: string;
};

/**
 * Removes a Project secret for a person whose role saves Flows.
 *
 * In a Space this computer keeps (as its Host, or without one): here,
 * after the checks, from its own records. In a Space a Host keeps: at
 * that Host, with this Device's key, for this computer's owner only.
 *
 * Night Shift asks for a person: the use case takes the request alone.
 */
export const removeProjectSecret =
	(ports: RemoveProjectSecretPorts) =>
	async (request: RemoveProjectSecret): Promise<void> => {
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
						saves: true,
					},
					ports.rules,
				);
				return ports.store.remove(at.projectId, request.name);
			},
			(hostId) =>
				ports.calls.ask(
					hostId,
					(client) =>
						client.projectSecrets.remove({ ...at, name: request.name }),
					{
						deadlineMs: ports.deadlineMs,
						olderHost: OLDER_HOST_PROJECT_SECRETS,
					},
				),
		);
	};
