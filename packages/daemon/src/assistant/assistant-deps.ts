import type { AgentHarness, installedSkills } from "@nightshift/agents";
import type {
	DecisionInput,
	DecisionResult,
	ValueInput,
	ValueResult,
} from "@nightshift/agents/types";
import type {
	CliToolStore,
	ConnectionStore,
	ProfileStore,
	SettingsStore,
} from "@nightshift/engine/device-config";
import type { AgentHarnessName, AssistantScope } from "@nightshift/flows";
import type { AuthoringSpace } from "./authoring";
import type { ThreadStore } from "./threads";

/** Where the assistant finds a profile, its harness and the project on this computer. */
export type AssistantDeps = {
	profiles: Pick<ProfileStore, "list">;
	settings: Pick<SettingsStore, "current">;
	/** The harness of that name, when it is added on this computer. */
	harnessFor: (name: AgentHarnessName) => AgentHarness | undefined;
	/** Whether the harness's program is on this computer. */
	installed: (name: AgentHarnessName) => boolean;
	/** The folder of the project's Clone on this computer (in that Space), or null. */
	clonePath: (projectId: string, spaceId?: string) => Promise<string | null>;
	/**
	 * Whether the project has no folder (ADR 22): Suggest and the chat work
	 * for it in the assistant's own folder. Without it: every project has one.
	 */
	withoutFolder?: (projectId: string) => Promise<boolean>;
	/** The engine as the Person sees the Space: the project's flows and runs. */
	space: (scope: AssistantScope) => AuthoringSpace;
	cliTools: Pick<CliToolStore, "list">;
	connections: Pick<ConnectionStore, "list">;
	/** The skills a harness can run in the project. Default: the installed ones. */
	skills?: typeof installedSkills;
	/** The chats. Default: a new store in memory. */
	threads?: ThreadStore;
	/**
	 * An empty folder of the assistant's own, for an explanation of a run
	 * whose project has no Clone here (the run says most of it), and for a
	 * project without a folder. Without it, neither can be answered here.
	 */
	ownFolder?: () => Promise<string>;
	/**
	 * One call to a model of this computer that returns a value in a shape.
	 * The Explainer and the Field writer use it when the person chose a
	 * model for them. Without it, only an agent can answer.
	 */
	decide?: (input: ValueInput) => Promise<ValueResult>;
	/**
	 * One call to a model of this computer that picks one of the labels, as
	 * a Decision in a run asks it. The check of the Decider uses it. Without
	 * it, the check asks for a value, when the model can make one.
	 */
	decideOption?: (input: DecisionInput) => Promise<DecisionResult>;
	/** How long a check waits for its answer. Default: `CHECK_TIMEOUTS`. */
	checkTimeouts?: { agentMs: number; modelMs: number };
};
