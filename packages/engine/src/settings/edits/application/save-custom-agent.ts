import type { CustomAgent } from "@nightshift/flows";
import type { Actor } from "../../../contract";
import { saveCustomAgent as saveCustomAgentStep } from "../domain/profile-edits";
import type { EditedSettings } from "./ports";

export type SaveCustomAgentPorts = { settings: EditedSettings };

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
