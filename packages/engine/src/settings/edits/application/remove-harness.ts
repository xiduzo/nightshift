import type { AgentHarnessName, HarnessName } from "@nightshift/flows";
import type { ComputerAccess } from "../../../access";
import type { Actor } from "../../../contract";
import type { ProfileStore } from "../../profiles";
import type { SettingsStore } from "../../settings";
import { removeHarness as removeHarnessStep } from "../domain/profile-edits";

export type RemoveHarnessPorts = {
	computerAccess: Pick<ComputerAccess, "openComputer">;
	settings: Pick<SettingsStore, "current" | "save">;
	profiles: Pick<ProfileStore, "list">;
	/** What a person calls each built-in harness. */
	labels: Readonly<Record<HarnessName, string>>;
};

/**
 * Removes a harness, or a custom agent for good. Refused while a profile
 * runs on it.
 * Only the owner of this computer may (`computerAccess.openComputer`).
 */
export const removeHarness =
	(ports: RemoveHarnessPorts) =>
	async (
		actor: Actor,
		request: { harness: AgentHarnessName },
	): Promise<void> => {
		ports.computerAccess.openComputer(actor);
		return removeHarnessStep(ports, request.harness, ports.labels);
	};
