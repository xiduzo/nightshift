import type { HarnessName } from "@nightshift/flows";
import { now } from "@nightshift/time";
import type { ComputerAccess } from "../../access";
import type { Actor } from "../../contract";
import type { SettingsStore } from "../../settings";
import { type AgentSetupView, agentIn } from "../domain/agent-status";
import type { AgentJobs } from "../domain/setup-jobs";
import { allowedSetup } from "../domain/setup-runs";
import type { AgentCatalog, Programs, SetupHere } from "./ports";
import { readAgentSetup } from "./read-agent-setup";

export type CancelAgentSetupPorts = {
	computerAccess: Pick<ComputerAccess, "openComputer">;
	catalog: AgentCatalog;
	settings: Pick<SettingsStore, "current">;
	programs: Pick<Programs, "found">;
	here: SetupHere;
	jobs: AgentJobs;
};

/**
 * Stops the install or the sign-in that runs.
 * Only the owner of this computer may (`computerAccess.openComputer`).
 */
export const cancelAgentSetup =
	(ports: CancelAgentSetupPorts) =>
	(
		actor: Actor,
		request: { harness: HarnessName; here: boolean },
	): AgentSetupView => {
		ports.computerAccess.openComputer(actor);
		allowedSetup(request, ports.here, ports.catalog);
		ports.jobs.cancel(request.harness, now());
		return agentIn(
			readAgentSetup(ports)(actor, { here: true }),
			request.harness,
		);
	};
