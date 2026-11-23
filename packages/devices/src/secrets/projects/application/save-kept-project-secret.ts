import type { Caller } from "../../../contract";
import type { ProjectSecretStore } from "../../kept";
import { type ProjectAt, projectAccess } from "../domain/project-secrets";
import type { EnginePlaces, KeeperSpaces, RoleRules } from "./ports";

export type SaveKeptProjectSecretPorts = {
	places: Pick<EnginePlaces, "spaceOf">;
	spaces: KeeperSpaces;
	rules: RoleRules;
	store: Pick<ProjectSecretStore, "set">;
};

/** The Project, and the secret. */
export type SaveKeptProjectSecret = ProjectAt & { name: string; value: string };

/** The Host keeps the Space and the Project is in it. The Caller's Person is a Member there whose role saves Flows. */
const mayChange = (
	ports: SaveKeptProjectSecretPorts,
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
 * Saves or replaces a Project secret this Host keeps. The Person who set it is the Caller's.
 *
 * A paired Device asks: the use case takes the Caller.
 */
export const saveKeptProjectSecret =
	(ports: SaveKeptProjectSecretPorts) =>
	async (caller: Caller, request: SaveKeptProjectSecret): Promise<void> => {
		const { name, value, ...at } = request;
		await mayChange(ports, caller, at);
		await ports.store.set(at, name, value, caller.personId);
	};
