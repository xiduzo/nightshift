import type { CustomAgent } from "@nightshift/flows";
import type { ComputerAccess } from "../../../access";
import type { Actor } from "../../../contract";
import type { SettingsStore } from "../../settings";
import { saveCustomAgent as saveCustomAgentStep } from "../domain/profile-edits";

export type SaveCustomAgentPorts = {
	computerAccess: Pick<ComputerAccess, "openComputer">;
	settings: Pick<SettingsStore, "current" | "save">;
};

/**
 * Adds a custom agent, or changes one (`previousSlug`). Its slug, the name
 * flows use, never changes. Refused when the slug is taken, or when the
 * agent of `previousSlug` is gone.
 * Only the owner of this computer may (`computerAccess.openComputer`).
 */
export const saveCustomAgent =
	(ports: SaveCustomAgentPorts) =>
	async (
		actor: Actor,
		request: { agent: CustomAgent; previousSlug?: string },
	): Promise<CustomAgent> => {
		ports.computerAccess.openComputer(actor);
		return saveCustomAgentStep(ports, request.agent, request.previousSlug);
	};
