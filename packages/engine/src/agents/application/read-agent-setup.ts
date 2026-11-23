import type { Actor } from "../../contract";
import { type AgentSetupStatus, agentViewOf } from "../domain/agent-status";
import type { AgentJobs } from "../domain/setup-jobs";
import { AGENT_BLOCKED, setupBlock } from "../domain/setup-place";
import { installCommand } from "../domain/setup-runs";
import type { AgentCatalog, AgentConfig, Programs, SetupHere } from "./ports";

export type ReadAgentSetupPorts = {
	catalog: AgentCatalog;
	config: Pick<AgentConfig, "bin">;
	programs: Pick<Programs, "found">;
	here: SetupHere;
	jobs: AgentJobs;
};

/** Lists the agents Night Shift can install and sign in here, and how each setup goes. */
export const readAgentSetup =
	(ports: ReadAgentSetupPorts) =>
	(_actor: Actor, request: { here: boolean }): AgentSetupStatus => {
		const reason = setupBlock(request.here, ports.here);
		return {
			available: reason === null,
			reason,
			message: reason ? AGENT_BLOCKED[reason] : null,
			agents: ports.catalog.all().map(({ harness, label, setup }) =>
				agentViewOf({
					harness,
					label,
					setup,
					path: ports.programs.found(ports.config.bin(harness)),
					signInCommand: ports.catalog.signInCommand(
						ports.config.bin(harness),
						setup,
					),
					job: ports.jobs.jobOf(harness),
					installCommand: installCommand(setup),
				}),
			),
		};
	};
