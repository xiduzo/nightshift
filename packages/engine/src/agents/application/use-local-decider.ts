import { Refusal } from "@nightshift/refusal";
import { now } from "@nightshift/time";
import type { ComputerAccess } from "../../access";
import type { Actor } from "../../contract";
import type { ConnectionStore } from "../../settings";
import type { DeciderSetupStatus } from "../domain/decider-status";
import { type DeciderJob, refuseDeciderBusy } from "../domain/setup-jobs";
import { DECIDER_BLOCKED, refuseBlocked } from "../domain/setup-place";
import type { Programs } from "./ports";
import { readDeciderSetup } from "./read-decider-setup";
import {
	type RunLocalDeciderPorts,
	runLocalDecider,
} from "./run-local-decider";

export type UseLocalDeciderPorts = RunLocalDeciderPorts & {
	computerAccess: Pick<ComputerAccess, "openComputer">;
	connections: Pick<ConnectionStore, "secretSource" | "setSecret">;
	programs: Pick<Programs, "where">;
	job: DeciderJob;
	typesafeKey: string;
};

/**
 * Starts Ollama when it does not answer, downloads the model, and makes it the decider.
 * Only the owner of this computer may (`computerAccess.openComputer`).
 */
export const useLocalDecider =
	(ports: UseLocalDeciderPorts) =>
	async (
		actor: Actor,
		request: { here: boolean },
	): Promise<DeciderSetupStatus> => {
		ports.computerAccess.openComputer(actor);
		refuseBlocked(request.here, ports.here, DECIDER_BLOCKED);
		refuseDeciderBusy(ports.job.busy());
		const o = await ports.ollama.status(ports.localModel.name);
		if (o.from === "local" && !o.installed && !o.answers) {
			throw new Refusal(
				"conflict",
				"Ollama is not on this computer. Install it first.",
			);
		}
		const run = ports.job.begin();
		run.set({ state: "starting", since: now() });
		runLocalDecider(ports)(run).catch((error) => {
			console.error("[decider-setup] the local decider failed:", error);
			run.set({
				state: "failed",
				problem: "Night Shift could not set up the decider. Try again.",
				at: now(),
			});
		});
		return readDeciderSetup(ports)(actor, request);
	};
