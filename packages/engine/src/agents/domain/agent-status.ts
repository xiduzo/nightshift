import type { HarnessName } from "@nightshift/flows";
import type { Actor } from "../../contract";
import type { AgentSetupJob } from "./setup-jobs";
import type { AgentSetupBlock } from "./setup-place";
import type { SetupFacts } from "./setup-runs";

/** The longest code a person can paste. */
export const MAX_CODE = 2_048;

/** One agent the guided setup can install and sign in. */
export type AgentSetupView = {
	harness: HarnessName;
	label: string;
	/** Who publishes the CLI: "Anthropic". */
	vendor: string;
	/** Where the CLI is on this computer now. Null: not found. */
	path: string | null;
	/** The exact command an install runs, and the script it downloads. */
	install: { command: string; source: string };
	/** The exact command a sign-in runs. */
	signIn: { command: string };
	job: AgentSetupJob;
};

export type AgentSetupStatus = {
	/** Setup can act here, for this request. */
	available: boolean;
	reason: AgentSetupBlock | null;
	/** Why not, for the person. Null when it is available. */
	message: string | null;
	agents: AgentSetupView[];
};

/** Who asks, and whether they are at this computer. */
export type AgentSetupCaller = { actor: Actor; here: boolean };

export function agentViewOf(input: {
	harness: HarnessName;
	label: string;
	setup: SetupFacts;
	path: string | null;
	signInCommand: string;
	job: AgentSetupJob;
	installCommand: string;
}): AgentSetupView {
	return {
		harness: input.harness,
		label: input.label,
		vendor: input.setup.vendor,
		path: input.path,
		install: {
			command: input.installCommand,
			source: input.setup.installScript,
		},
		signIn: { command: input.signInCommand },
		job: input.job,
	};
}

/** The setup of one agent in the list. */
export function agentIn(
	status: AgentSetupStatus,
	harness: AgentSetupView["harness"],
): AgentSetupView {
	const agent = status.agents.find((row) => row.harness === harness);
	if (!agent) throw new Error(`No setup for ${harness}.`);
	return agent;
}
