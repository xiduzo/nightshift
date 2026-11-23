import type { Caller } from "../../../contract";
import type { ProjectSecretStore } from "../../kept";
import { type ProjectAt, projectAccess } from "../domain/project-secrets";
import type { EnginePlaces, KeeperSpaces, RoleRules } from "./ports";

export type TakeKeptProjectSecretPorts = {
	places: Pick<EnginePlaces, "spaceOf">;
	spaces: KeeperSpaces;
	rules: RoleRules;
	store: Pick<ProjectSecretStore, "values">;
};

/** The Project, and the secret. */
export type TakeKeptProjectSecret = ProjectAt & { name: string };

/** The Host keeps the Space and the Project is in it. The Caller's Person is a Member there whose role saves Flows. */
const mayChange = (
	ports: TakeKeptProjectSecretPorts,
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
 * Reads a Project secret this Host keeps, for a move only: the Device saves it elsewhere, then removes it. Null: none of that name.
 *
 * A paired Device asks: the use case takes the Caller.
 */
export const takeKeptProjectSecret =
	(ports: TakeKeptProjectSecretPorts) =>
	async (
		caller: Caller,
		request: TakeKeptProjectSecret,
	): Promise<string | null> => {
		const { name, ...at } = request;
		await mayChange(ports, caller, at);
		return (await ports.store.values(at.projectId, [name]))[name] ?? null;
	};
