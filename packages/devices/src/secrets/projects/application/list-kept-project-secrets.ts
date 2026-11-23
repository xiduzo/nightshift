import type { Caller } from "../../../contract";
import type { ProjectSecretStore } from "../../kept";
import {
	type NamedSecret,
	namedSecrets,
	type ProjectAt,
	projectAccess,
	settersOf,
} from "../domain/project-secrets";
import type { EnginePlaces, KeeperSpaces, Members, RoleRules } from "./ports";

export type ListKeptProjectSecretsPorts = {
	places: Pick<EnginePlaces, "spaceOf">;
	spaces: KeeperSpaces;
	rules: RoleRules;
	store: Pick<ProjectSecretStore, "list">;
	members: Pick<Members, "names">;
};

/**
 * Lists the names of a Project's secrets this Host keeps, with who set
 * each and when, never a value. It keeps the Space, the Project is in it,
 * and the Caller's Person is a Member there.
 *
 * A paired Device asks: the use case takes the Caller.
 */
export const listKeptProjectSecrets =
	(ports: ListKeptProjectSecretsPorts) =>
	async (caller: Caller, at: ProjectAt): Promise<NamedSecret[]> => {
		await projectAccess(
			ports.places.spaceOf,
			ports.spaces.hostOf,
			at,
			{ roleIn: caller.roleIn, saves: false },
			ports.rules,
		);
		const kept = await ports.store.list(at.projectId);
		return namedSecrets(kept, await ports.members.names(settersOf(kept)));
	};
