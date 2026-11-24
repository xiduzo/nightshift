import type { CustomAgent } from "@nightshift/flows";
import type { Actor } from "../../../contract";
import type { SettingsStore } from "../../settings";
import { saveCustomAgent as saveCustomAgentStep } from "../domain/profile-edits";

export type SaveCustomAgentPorts = {
	settings: Pick<SettingsStore, "current" | "save">;
};

/**
 * Adds a custom agent, or changes one (`previousSlug`). Its slug, the name
 * flows use, never changes. Refused when the slug is taken, or when the
 * agent of `previousSlug` is gone.
 */
export const saveCustomAgent =
	(ports: SaveCustomAgentPorts) =>
	(
		_actor: Actor,
		request: { agent: CustomAgent; previousSlug?: string },
	): Promise<CustomAgent> =>
		saveCustomAgentStep(ports, request.agent, request.previousSlug);
