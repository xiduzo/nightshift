import type { HarnessName } from "@nightshift/flows";
import { now } from "@nightshift/time";
import type { Actor } from "../../contract";
import type { SettingsStore } from "../../settings";
import type { AgentSetupView } from "../domain/agent-status";
import type { AgentJobs } from "../domain/setup-jobs";
import { allowedSetup } from "../domain/setup-runs";
import type { AgentCatalog, Programs, SetupHere } from "./ports";
import { readAgentSetup } from "./read-agent-setup";

export type CancelAgentSetupPorts = {
	catalog: AgentCatalog;
	settings: Pick<SettingsStore, "current">;
	programs: Pick<Programs, "found">;
	here: SetupHere;
	jobs: AgentJobs;
};

/** Stops the install or the sign-in that runs. */
export const cancelAgentSetup =
	(ports: CancelAgentSetupPorts) =>
	(
		actor: Actor,
		request: { harness: HarnessName; here: boolean },
	): AgentSetupView => {
		allowedSetup(
			request.here,
			ports.here,
			(h) => ports.catalog.of(h),
			(h) => ports.catalog.label(h),
			request.harness,
		);
		ports.jobs.cancel(request.harness, now());
		const agent = readAgentSetup(ports)(actor, { here: true }).agents.find(
			(row) => row.harness === request.harness,
		);
		if (!agent) throw new Error(`No setup for ${request.harness}.`);
		return agent;
	};
