import type { Caller } from "../../../contract";
import type { ProjectSecretStore } from "../../kept";
import { type ProjectAt, projectAccess } from "../domain/project-secrets";
import type { EnginePlaces, KeeperSpaces, RoleRules } from "./ports";

export type RemoveKeptProjectSecretPorts = {
	places: Pick<EnginePlaces, "spaceOf">;
	spaces: KeeperSpaces;
	rules: RoleRules;
	store: Pick<ProjectSecretStore, "remove">;
};

/** The Project, and the secret. */
export type RemoveKeptProjectSecret = ProjectAt & { name: string };

/** The Host keeps the Space and the Project is in it. The Caller's Person is a Member there whose role saves Flows. */
const mayChange = (
	ports: RemoveKeptProjectSecretPorts,
	caller: Caller,
	at: ProjectAt,
): Promise<void> =>
	projectAccess(
		ports.places.spaceOf,
		ports.spaces.hostOf,
		at,
		{ roleIn: caller.roleIn, saves: true },
		ports.rules,
	);

/**
 * Removes a Project secret this Host keeps.
 *
 * A paired Device asks: the use case takes the Caller.
 */
export const removeKeptProjectSecret =
	(ports: RemoveKeptProjectSecretPorts) =>
	async (caller: Caller, request: RemoveKeptProjectSecret): Promise<void> => {
		const { name, ...at } = request;
		await mayChange(ports, caller, at);
		await ports.store.remove(at.projectId, name);
	};
