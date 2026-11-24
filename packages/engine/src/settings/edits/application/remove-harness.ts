import {
	type AgentHarnessName,
	type HarnessName,
	isAgentProfile,
	isCustomHarness,
} from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import type { ComputerAccess } from "../../../access";
import type { Actor } from "../../../contract";
import type { ProfileStore } from "../../profiles";
import type { SettingsStore } from "../../settings";
import { customAgentOf, harnessInUse } from "../domain/profile-edits";

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
		const { harness } = request;
		const values = ports.settings.current();
		const custom = customAgentOf(values.customAgents, harness);
		const label = isCustomHarness(harness)
			? (custom?.label ?? harness)
			: ports.labels[harness];
		const using = ports.profiles
			.list()
			.filter((p) => isAgentProfile(p) && p.harness === harness)
			.map((p) => p.name);
		if (using.length > 0) {
			throw new Refusal("conflict", harnessInUse(using, label));
		}
		if (isCustomHarness(harness)) {
			await ports.settings.save({
				customAgents: values.customAgents.filter((a) => a !== custom),
			});
			return;
		}
		await ports.settings.save({
			harnesses: values.harnesses.filter((h) => h !== harness),
		});
	};
