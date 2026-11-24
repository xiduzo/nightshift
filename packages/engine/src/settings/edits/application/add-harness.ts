import type { HarnessName } from "@nightshift/flows";
import type { Actor } from "../../../contract";
import type { SettingsStore } from "../../settings";
import { addHarness as addHarnessStep } from "../domain/profile-edits";

export type AddHarnessPorts = {
	settings: Pick<SettingsStore, "current" | "save">;
};

/** Adds a built-in harness. Nothing changes when it is added already. */
export const addHarness =
	(ports: AddHarnessPorts) =>
	(_actor: Actor, request: { harness: HarnessName }): Promise<void> =>
		addHarnessStep(ports, request.harness);
