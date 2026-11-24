import type { AgentHarnessName, HarnessName } from "@nightshift/flows";
import type { Actor } from "../../../contract";
import type { ProfileStore } from "../../profiles";
import type { SettingsStore } from "../../settings";
import { removeHarness as removeHarnessStep } from "../domain/profile-edits";

export type RemoveHarnessPorts = {
	settings: Pick<SettingsStore, "current" | "save">;
	profiles: Pick<ProfileStore, "list">;
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
