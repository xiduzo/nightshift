import type { Caller } from "../../../contract";
import type { SpaceSecretStore } from "../../kept";
import { spaceAccess } from "../domain/project-secrets";
import type { KeeperSpaces, RoleRules } from "./ports";

export type TakeKeptSpaceSecretPorts = {
	spaces: KeeperSpaces;
	rules: RoleRules;
	spaceStore: Pick<SpaceSecretStore, "values">;
};

/** The Space, and the secret. */
export type TakeKeptSpaceSecret = { spaceId: string; name: string };

/**
 * Reads a Space secret this Host keeps (ADR 18), for a move only: the Device saves it elsewhere, then removes it. Null: none of that name. It keeps the Space, and the Caller's Person is a Member there
 * whose role saves Flows.
 *
 * A paired Device asks: the use case takes the Caller.
 */
export const takeKeptSpaceSecret =
	(ports: TakeKeptSpaceSecretPorts) =>
	async (
		caller: Caller,
		request: TakeKeptSpaceSecret,
	): Promise<string | null> => {
		const { spaceId } = request;
		await spaceAccess(
			ports.spaces.hostOf,
			spaceId,
			{ roleIn: caller.roleIn, saves: true },
			ports.rules,
		);
		const { name } = request;
		return (await ports.spaceStore.values(spaceId, [name]))[name] ?? null;
	};
