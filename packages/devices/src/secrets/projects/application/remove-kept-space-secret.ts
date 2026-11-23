import type { Caller } from "../../../contract";
import type { SpaceSecretStore } from "../../kept";
import { spaceAccess } from "../domain/project-secrets";
import type { KeeperSpaces, RoleRules } from "./ports";

export type RemoveKeptSpaceSecretPorts = {
	spaces: KeeperSpaces;
	rules: RoleRules;
	spaceStore: Pick<SpaceSecretStore, "remove">;
};

/** The Space, and the secret. */
export type RemoveKeptSpaceSecret = { spaceId: string; name: string };

/**
 * Removes a Space secret this Host keeps (ADR 18). It keeps the Space, and the Caller's Person is a Member there
 * whose role saves Flows.
 *
 * A paired Device asks: the use case takes the Caller.
 */
export const removeKeptSpaceSecret =
	(ports: RemoveKeptSpaceSecretPorts) =>
	async (caller: Caller, request: RemoveKeptSpaceSecret): Promise<void> => {
		const { spaceId } = request;
		await spaceAccess(
			ports.spaces.hostOf,
			spaceId,
			{ roleIn: caller.roleIn, saves: true },
			ports.rules,
		);
		await ports.spaceStore.remove(spaceId, request.name);
	};
