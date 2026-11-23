import type { AgentHarnessName, HarnessName } from "@nightshift/flows";
import type { Actor } from "../../../contract";
import { removeHarness as removeHarnessStep } from "../domain/profile-edits";
import type { EditedProfiles, EditedSettings } from "./ports";

export type RemoveHarnessPorts = {
	settings: EditedSettings;
	profiles: Pick<EditedProfiles, "list">;
	/** What a person calls each built-in harness. */
	labels: Readonly<Record<HarnessName, string>>;
};

/**
 * Removes a harness, or a custom agent for good. Refused while a profile
 * runs on it.
 */
export const removeHarness =
	(ports: RemoveHarnessPorts) =>
	(_actor: Actor, request: { harness: AgentHarnessName }): Promise<void> =>
		removeHarnessStep(ports, request.harness, ports.labels);
