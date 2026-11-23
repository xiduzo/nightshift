import type { HarnessName } from "@nightshift/flows";
import type { Actor } from "../../../contract";
import { addHarness as addHarnessStep } from "../domain/profile-edits";
import type { EditedSettings } from "./ports";

export type AddHarnessPorts = { settings: EditedSettings };

/** Adds a built-in harness. Nothing changes when it is added already. */
export const addHarness =
	(ports: AddHarnessPorts) =>
	(_actor: Actor, request: { harness: HarnessName }): Promise<void> =>
		addHarnessStep(ports, request.harness);
