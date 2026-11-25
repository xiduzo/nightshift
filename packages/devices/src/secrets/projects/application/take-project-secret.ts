import { hostAnswer, takenSecretSchema } from "../../../contract";
import type { HostCalls } from "../../calls";
import type { ProjectSecretStore } from "../../kept";
import {
	atKeeper,
	type ProjectAt,
	projectAccess,
} from "../domain/project-secrets";
import type { EnginePlaces, KeeperSpaces, Members, RoleRules } from "./ports";

export type TakeProjectSecretPorts = {
	spaces: KeeperSpaces;
	places: Pick<EnginePlaces, "spaceOf">;
	members: Pick<Members, "roleIn">;
	rules: RoleRules;
	store: Pick<ProjectSecretStore, "values">;
	calls: Pick<HostCalls, "ask">;
	/** The Person who owns this computer: the only one who acts through its key. */
	ownerId: string;
	/** How long one call of the Host may take. */
	deadlineMs: number;
};

/** The Project, the Person who asks, and the secret. */
export type TakeProjectSecret = {
	project: ProjectAt;
	name: string;
	personId: string;
};

/**
 * Reads a Project secret for a move, for a person whose role saves Flows. Null: none of that name.
 *
 * In a Space this computer keeps (as its Host, or without one): here,
 * after the checks, from its own records. In a Space a Host keeps: at
 * that Host, with this Device's key, for this computer's owner only.
 *
 * Night Shift asks for a person: the use case takes the request alone.
 */
export const takeProjectSecret =
	(ports: TakeProjectSecretPorts) =>
	async (request: TakeProjectSecret): Promise<string | null> => {
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
				return (
					(await ports.store.values(at.projectId, [request.name]))[
						request.name
					] ?? null
				);
			},
			async (hostId) =>
				hostAnswer(
					takenSecretSchema,
					await ports.calls.ask(
						hostId,
						(client) =>
							client.projectSecrets.take({ ...at, name: request.name }),
						{ deadlineMs: ports.deadlineMs },
					),
				),
		);
	};
