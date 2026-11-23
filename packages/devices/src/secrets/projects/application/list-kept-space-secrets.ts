import type { Caller } from "../../../contract";
import type { SpaceSecretStore } from "../../kept";
import {
	type NamedSecret,
	namedSecrets,
	settersOf,
	spaceAccess,
} from "../domain/project-secrets";
import type { KeeperSpaces, Members, RoleRules } from "./ports";

export type ListKeptSpaceSecretsPorts = {
	spaces: KeeperSpaces;
	rules: RoleRules;
	spaceStore: Pick<SpaceSecretStore, "list">;
	members: Pick<Members, "names">;
};

/** The Space. */
export type ListKeptSpaceSecrets = { spaceId: string };

/**
 * Lists the names of a Space's secrets this Host keeps (ADR 18), with who
 * set each and when, never a value. It keeps the Space, and the Caller's
 * Person is a Member there.
 *
 * A paired Device asks: the use case takes the Caller.
 */
export const listKeptSpaceSecrets =
	(ports: ListKeptSpaceSecretsPorts) =>
	async (
		caller: Caller,
		request: ListKeptSpaceSecrets,
	): Promise<NamedSecret[]> => {
		const { spaceId } = request;
		await spaceAccess(
			ports.spaces.hostOf,
			spaceId,
			{ roleIn: caller.roleIn, saves: false },
			ports.rules,
		);
		const kept = await ports.spaceStore.list(spaceId);
		return namedSecrets(kept, await ports.members.names(settersOf(kept)));
	};
