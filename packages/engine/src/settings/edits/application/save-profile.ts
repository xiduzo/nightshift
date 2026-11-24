import type { Profile } from "@nightshift/flows";
import type { ComputerAccess } from "../../../access";
import type { Actor } from "../../../contract";
import type { CliToolStore } from "../../cli-tools";
import type { ConnectionStore } from "../../connections";
import type { ProfileStore } from "../../profiles";
import {
	type ProfileView,
	saveProfile as saveProfileStep,
} from "../domain/profile-edits";

export type SaveProfilePorts = {
	computerAccess: Pick<ComputerAccess, "openComputer">;
	connections: Pick<ConnectionStore, "get">;
	cliTools: Pick<CliToolStore, "get">;
	profiles: Pick<ProfileStore, "get" | "byName" | "list" | "save">;
};

/**
 * Adds a profile, or changes or renames the one of `id`. A rename keeps
 * the id. Refused when the name is taken, when the profile of `id` is
 * gone, or when an Agent Profile names a connection or a CLI tool that
 * does not exist.
 * Only the owner of this computer may (`computerAccess.openComputer`).
 */
export const saveProfile =
	(ports: SaveProfilePorts) =>
	async (
		actor: Actor,
		request: { profile: Profile; id?: string },
	): Promise<ProfileView> => {
		ports.computerAccess.openComputer(actor);
		return saveProfileStep(
			ports,
			request.profile,
			request.id === undefined ? {} : { id: request.id },
		);
	};
