import { now } from "@nightshift/time";

import type { Actor } from "../../contract";
import type { DeciderSetupStatus } from "../domain/decider-status";
import type { DeciderJob } from "../domain/setup-jobs";
import { DECIDER_BLOCKED, refuseBlocked } from "../domain/setup-place";
import type { LocalOllama, SetupHere } from "./ports";
import { readDeciderSetup } from "./read-decider-setup";
import type { UseLocalDeciderPorts } from "./use-local-decider";

export type CancelDeciderSetupPorts = UseLocalDeciderPorts & {
	ollama: Pick<LocalOllama, "status" | "cancelPull">;
	here: SetupHere;
	job: DeciderJob;
	localModel: { name: string };
};

/** Stops the install, the start or the download that runs. */
export const cancelDeciderSetup =
	(ports: CancelDeciderSetupPorts) =>
	async (
		actor: Actor,
		request: { here: boolean },
	): Promise<DeciderSetupStatus> => {
		refuseBlocked(request.here, ports.here, DECIDER_BLOCKED);
		const downloading = ports.job.cancel(now());
		if (downloading) await ports.ollama.cancelPull(ports.localModel.name);
		return readDeciderSetup(ports)(actor, request);
	};
