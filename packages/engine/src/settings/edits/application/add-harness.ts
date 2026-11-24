import type { HarnessName } from "@nightshift/flows";
import type { ComputerAccess } from "../../../access";
import type { Actor } from "../../../contract";
import type { SettingsStore } from "../../settings";
import { addHarness as addHarnessStep } from "../domain/profile-edits";

export type AddHarnessPorts = {
	computerAccess: Pick<ComputerAccess, "openComputer">;
	settings: Pick<SettingsStore, "current" | "save">;
};

/**
 * Adds a built-in harness. Nothing changes when it is added already. Only the
 * owner of this computer may (`computerAccess.openComputer`).
 */
export const addHarness =
	(ports: AddHarnessPorts) =>
	async (actor: Actor, request: { harness: HarnessName }): Promise<void> => {
		ports.computerAccess.openComputer(actor);
		return addHarnessStep(ports, request.harness);
	};
