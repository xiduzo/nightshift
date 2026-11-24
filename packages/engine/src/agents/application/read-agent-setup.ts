import type { Actor } from "../../contract";
import { HARNESS_BIN, type SettingsStore } from "../../settings";
import { type AgentSetupStatus, agentViewOf } from "../domain/agent-status";
import type { AgentJobs } from "../domain/setup-jobs";
import { AGENT_BLOCKED, setupBlock } from "../domain/setup-place";
import { installCommand } from "../domain/setup-runs";
import type { AgentCatalog, Programs, SetupHere } from "./ports";

export type ReadAgentSetupPorts = {
	catalog: AgentCatalog;
	settings: Pick<SettingsStore, "current">;
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
					path: ports.programs.found(
						String(ports.settings.current()[HARNESS_BIN[harness]]),
					),
					signInCommand: ports.catalog.signInCommand(
						String(ports.settings.current()[HARNESS_BIN[harness]]),
						setup,
					),
					job: ports.jobs.jobOf(harness),
					installCommand: installCommand(setup),
				}),
			),
		};
	};
