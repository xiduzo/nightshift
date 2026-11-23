import type { Caller } from "../../../contract";
import type { SpaceSecretStore } from "../../kept";
import { spaceAccess } from "../domain/project-secrets";
import type { KeeperSpaces, RoleRules } from "./ports";

export type SaveKeptSpaceSecretPorts = {
	spaces: KeeperSpaces;
	rules: RoleRules;
	spaceStore: Pick<SpaceSecretStore, "set">;
};

/** The Space, and the secret. */
export type SaveKeptSpaceSecret = {
	spaceId: string;
	name: string;
	value: string;
};

/**
 * Saves or replaces a Space secret this Host keeps (ADR 18). The Person who set it is the Caller's. It keeps the Space, and the Caller's Person is a Member there
 * whose role saves Flows.
 *
 * A paired Device asks: the use case takes the Caller.
 */
export const saveKeptSpaceSecret =
	(ports: SaveKeptSpaceSecretPorts) =>
	async (caller: Caller, request: SaveKeptSpaceSecret): Promise<void> => {
		const { spaceId } = request;
		await spaceAccess(
			ports.spaces.hostOf,
			spaceId,
			{ roleIn: caller.roleIn, saves: true },
			ports.rules,
		);
		await ports.spaceStore.set(
			spaceId,
			request.name,
			request.value,
			caller.personId,
		);
	};
