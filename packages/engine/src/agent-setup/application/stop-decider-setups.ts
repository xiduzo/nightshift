import { now } from "@nightshift/time";

import type { DeciderJob } from "../domain/setup-jobs";

export type StopDeciderSetupsPorts = { job: DeciderJob };

/** Stops the job: the daemon stops, or reloads. */
export const stopDeciderSetups =
	(ports: StopDeciderSetupsPorts) =>
	(_request?: Record<string, never>): void => {
		ports.job.stop(now());
	};
