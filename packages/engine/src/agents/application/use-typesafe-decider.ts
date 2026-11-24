import { Refusal } from "@nightshift/refusal";
import { now } from "@nightshift/time";
import type { Actor } from "../../contract";
import { saveProfile } from "../../settings";
import {
	MAX_KEY,
	saveNamedModelProfile,
	TYPESAFE_PROFILE,
	withModelAgents,
} from "../domain/decider-plan";
import type { DeciderSetupStatus } from "../domain/decider-status";
import { refuseDeciderBusy } from "../domain/setup-jobs";
import { DECIDER_BLOCKED, refuseBlocked } from "../domain/setup-place";
import { readDeciderSetup } from "./read-decider-setup";
import type { UseLocalDeciderPorts } from "./use-local-decider";

export type UseTypesafeDeciderPorts = UseLocalDeciderPorts;

/**
 * Saves the TypeSafe key, and makes TypeSafe Jev the decider. Null keeps
 * the key that is saved already.
 */
export const useTypesafeDecider =
	(ports: UseTypesafeDeciderPorts) =>
	async (
		actor: Actor,
		request: { key: string | null; here: boolean },
	): Promise<DeciderSetupStatus> => {
		refuseBlocked(request.here, ports.here, DECIDER_BLOCKED);
		refuseDeciderBusy(ports.job.busy());
		const line = request.key?.trim() ?? "";
		if (line === "") {
			if (ports.connections.secretSource(ports.typesafeKey) === "missing") {
				throw new Refusal("invalid", "Paste the key TypeSafe gave you.");
			}
		} else {
			if (line.length > MAX_KEY || /\s/.test(line)) {
				throw new Refusal("invalid", "Paste the key as TypeSafe shows it.");
			}
			try {
				await ports.connections.setSecret(ports.typesafeKey, line);
			} catch (error) {
				console.error(
					"[decider-setup] the TypeSafe key was not saved:",
					String(error).replaceAll(line, "[the key]"),
				);
				throw new Refusal(
					"unavailable",
					"Night Shift could not save the key. Try again.",
				);
			}
		}
		const run = ports.job.begin();
		const profile = await saveNamedModelProfile(
			TYPESAFE_PROFILE,
			{ decider: "typesafe" },
			(name) => ports.profiles.byName(name),
			(next, id) => saveProfile(ports, next, id === undefined ? {} : { id }),
		);
		await ports.settings.save({
			decisionDecider: "typesafe",
			builtinAgents: withModelAgents(
				ports.settings.current().builtinAgents,
				profile.name,
				"typesafe",
			),
		});
		run.set({
			state: "ready",
			decider: "typesafe",
			profileId: profile.id,
			profileName: profile.name,
			at: now(),
		});
		return readDeciderSetup(ports)(actor, { here: request.here });
	};
