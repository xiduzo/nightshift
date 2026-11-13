/**
 * The query and mutation options of the agents: Agent Profiles, harnesses,
 * Connections and their Secrets, CLI Tools, deciders, the guided setup of
 * an agent and of a decider, and the check of Night Shift's own agents.
 */

import type { BuiltinAgentId } from "@nightshift/flows";
import type {
	AgentProfileRow,
	AgentSetupJob,
	AgentSetupStatus,
	CheckTarget,
	DeciderSetupJob,
	DeciderSetupStatus,
	HarnessRowName,
	ModelProfileRow,
	ProfileRow,
} from "@/shared/api";
import { client, orpc } from "@/shared/api";

export const profileQueries = {
	/** The profiles of this computer: Agent Profiles and Model Profiles. */
	list: () => orpc.profiles.list.queryOptions(),
	/** The Agent Profiles of this computer, for Agent nodes and the assistant. */
	agents: () => ({
		...orpc.profiles.list.queryOptions(),
		select: (rows: ProfileRow[]) =>
			rows.filter((p): p is AgentProfileRow => "harness" in p),
	}),
	/** The Model Profiles of this computer, for Decisions and Values decided by a model. */
	models: () => ({
		...orpc.profiles.list.queryOptions(),
		select: (rows: ProfileRow[]) =>
			rows.filter((p): p is ModelProfileRow => "decider" in p),
	}),
};

export const profileMutations = {
	save: orpc.profiles.save.mutationOptions,
	remove: orpc.profiles.remove.mutationOptions,
};

export const harnessQueries = {
	/** The harnesses of this computer, with their state and Custom Agents. */
	list: () => orpc.harnesses.list.queryOptions(),
	/** The models a harness offers. */
	models: (harness: HarnessRowName) =>
		orpc.harnesses.models.queryOptions({ input: { harness } }),
	/** The skills a harness finds for a project. */
	skills: (harness: HarnessRowName, projectId: string) =>
		orpc.harnesses.skills.queryOptions({ input: { harness, projectId } }),
};

export const harnessMutations = {
	add: orpc.harnesses.add.mutationOptions,
	remove: orpc.harnesses.remove.mutationOptions,
	saveCustom: orpc.harnesses.saveCustom.mutationOptions,
};

export const connectionQueries = {
	/** The Connections (MCP servers) of this computer. */
	list: () => orpc.connections.list.queryOptions(),
	/** Whether a program or a harness login is ready. */
	check: (target: CheckTarget) =>
		orpc.connections.check.queryOptions({ input: { target } }),
	/** The tools of one Connection. */
	tools: (name: string) =>
		orpc.connections.tools.queryOptions({ input: { name } }),
};

export const connectionMutations = {
	save: orpc.connections.save.mutationOptions,
	remove: orpc.connections.remove.mutationOptions,
	test: orpc.connections.test.mutationOptions,
	setSecret: orpc.connections.setSecret.mutationOptions,
	removeSecret: orpc.connections.removeSecret.mutationOptions,
	moveSecret: orpc.connections.moveSecret.mutationOptions,
};

/** The secrets of a project (ADR 13): the Host of its Space keeps them. */
export const projectSecretQueries = {
	/** The secrets of one project: names, who set each and when. */
	list: (projectId: string) =>
		orpc.projects.secrets.queryOptions({ input: { projectId } }),
};

export const projectSecretMutations = {
	set: orpc.projects.setSecret.mutationOptions,
	remove: orpc.projects.removeSecret.mutationOptions,
	/** To this computer or to Personal. */
	moveOut: orpc.projects.moveSecretOut.mutationOptions,
	/** From this computer or from Personal. */
	moveIn: orpc.projects.moveSecretIn.mutationOptions,
	/** From another of your devices: that device moves its own value. */
	moveFromDevice: orpc.projects.moveSecretFromDevice.mutationOptions,
};

/** The secrets of the Space you work in (ADR 18). */
export const spaceSecretQueries = {
	list: () => orpc.projects.spaceSecrets.queryOptions(),
};

export const spaceSecretMutations = {
	/** From this computer or from Personal. */
	moveIn: orpc.projects.moveSecretToSpace.mutationOptions,
};

/** What a list of shared secrets can do: a project's, or the Space's. */
export type SharedSecretActions = {
	set(input: { name: string; value: string }): Promise<void>;
	remove(input: { name: string }): Promise<void>;
	moveOut(input: { name: string; to: "personal" | "computer" }): Promise<void>;
};

export const projectSecretActions = (
	projectId: string,
): SharedSecretActions => ({
	set: (input) => client.projects.setSecret({ projectId, ...input }),
	remove: (input) => client.projects.removeSecret({ projectId, ...input }),
	moveOut: (input) => client.projects.moveSecretOut({ projectId, ...input }),
});

export const spaceSecretActions: SharedSecretActions = {
	set: (input) => client.projects.setSpaceSecret(input),
	remove: (input) => client.projects.removeSpaceSecret(input),
	moveOut: (input) => client.projects.moveSecretFromSpace(input),
};

export const cliToolQueries = {
	/** The CLI Tools of this computer. */
	list: () => orpc.cliTools.list.queryOptions(),
	/** Whether this computer finds a CLI Tool. */
	check: (name: string) =>
		orpc.cliTools.check.queryOptions({ input: { name } }),
	/** The programs this computer finds, to pick a new CLI Tool from. */
	programs: () => orpc.cliTools.programs.queryOptions(),
};

export const cliToolMutations = {
	save: orpc.cliTools.save.mutationOptions,
	remove: orpc.cliTools.remove.mutationOptions,
	signIn: orpc.cliTools.signIn.mutationOptions,
};

export const programQueries = {
	/** The agent CLIs and the kits' tools on this computer that are not set up yet. */
	found: () => orpc.programs.found.queryOptions(),
};

export const programMutations = {
	setUp: orpc.programs.setUp.mutationOptions,
};

export const otherDeviceQueries = {
	/** The owner's other Devices: their profiles and secret names. */
	list: () => orpc.devices.others.queryOptions(),
};

export const otherDeviceMutations = {
	/** Another of your devices moves a secret saved there to Personal, or removes it. */
	moveSecret: orpc.devices.moveSecret.mutationOptions,
};

export const deciderQueries = {
	/** The deciders of this computer: who decides a Decision node, and whether its key is set. */
	list: () => orpc.deciders.list.queryOptions(),
};

export const deciderMutations = {
	/** Asks the server at a Model Profile's address for its models: the test of the address. */
	modelsAt: orpc.deciders.modelsAt.mutationOptions,
};

/** The job states of a guided setup that still run (`setupRuns` in `setup/setup-state.ts`). */
const SETUP_RUNNING: ReadonlySet<AgentSetupJob["state"]> = new Set([
	"installing",
	"checking",
	"signing-in",
	"code-needed",
]);

/** How often the guided setup is asked about while a job runs. */
const SETUP_POLL_MS = 1_000;

/** The guided setup of an agent on this computer (ADR 25). */
export const agentSetupQueries = {
	/**
	 * What the setup can do here, and how each agent's setup goes. Asks
	 * again every second while a job runs.
	 */
	status: () => ({
		...orpc.agentSetup.status.queryOptions(),
		refetchInterval: (query: { state: { data?: AgentSetupStatus } }) =>
			query.state.data?.agents.some((agent) =>
				SETUP_RUNNING.has(agent.job.state),
			)
				? SETUP_POLL_MS
				: false,
	}),
};

export const agentSetupMutations = {
	/** Installs an agent with its vendor's installer, after the person confirms. */
	install: orpc.agentSetup.install.mutationOptions,
	/** Signs an agent in, then adds it with a profile. */
	signIn: orpc.agentSetup.signIn.mutationOptions,
	/** Gives a waiting sign-in the code its page shows. */
	sendCode: orpc.agentSetup.sendCode.mutationOptions,
	/** Stops an install or a sign-in. */
	cancel: orpc.agentSetup.cancel.mutationOptions,
};

/** The job states of a decider setup that still run (`deciderRuns` in `setup/decider-state.ts`). */
const DECIDER_RUNNING: ReadonlySet<DeciderSetupJob["state"]> = new Set([
	"installing",
	"starting",
	"downloading",
]);

/** The setup of a decider on this computer (Q22): Local with Ollama, or a TypeSafe key. */
export const deciderSetupQueries = {
	/**
	 * Which decider new Decision nodes start on, whether Ollama and its
	 * model are here, and how a setup goes. Asks again every second while a
	 * job runs.
	 */
	status: () => ({
		...orpc.deciderSetup.status.queryOptions(),
		refetchInterval: (query: { state: { data?: DeciderSetupStatus } }) =>
			query.state.data && DECIDER_RUNNING.has(query.state.data.job.state)
				? SETUP_POLL_MS
				: false,
	}),
};

export const deciderSetupMutations = {
	/** Installs Ollama with Homebrew, after the person confirms, then sets up the local decider. */
	installOllama: orpc.deciderSetup.installOllama.mutationOptions,
	/** Starts Ollama, downloads the model, and makes it the decider. */
	useLocal: orpc.deciderSetup.useLocal.mutationOptions,
	/** Saves the TypeSafe key, and makes TypeSafe Jev the decider. */
	useTypesafe: orpc.deciderSetup.useTypesafe.mutationOptions,
	/** Stops the install or the download. */
	cancel: orpc.deciderSetup.cancel.mutationOptions,
};

/** Night Shift's own agents: who answers for each, and the check that one answers. */
export const builtinQueries = {
	/** Who answers for each agent on this computer now. */
	agents: () => orpc.assistant.agents.queryOptions(),
	/**
	 * The last check of one agent. It asks only when the person starts it
	 * (`fetchQuery`): a check costs a little. The result stays while the app
	 * is open, so each place that shows it reads the same one.
	 */
	check: (agent: BuiltinAgentId) =>
		orpc.assistant.check.queryOptions({
			input: { agent },
			enabled: false,
			staleTime: Number.POSITIVE_INFINITY,
			gcTime: Number.POSITIVE_INFINITY,
			retry: false,
			meta: { quietErrors: true },
		}),
};
