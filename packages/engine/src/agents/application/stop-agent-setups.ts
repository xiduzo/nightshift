import { now } from "@nightshift/time";

import type { AgentJobs } from "../domain/setup-jobs";

export type StopAgentSetupsPorts = { jobs: AgentJobs };

/** Stops every job: the daemon stops, or reloads. */
export const stopAgentSetups =
	(ports: StopAgentSetupsPorts) =>
	(_request?: Record<string, never>): void => {
		ports.jobs.stopAll(now());
	};
