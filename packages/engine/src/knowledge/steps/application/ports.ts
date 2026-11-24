import type { KnowledgePort, KnowledgeUse } from "@nightshift/agents/knowledge";
import type { SessionContribution } from "@nightshift/agents/types";

/**
 * The driven port of knowledge/steps, filled by another package
 * (`@filledBy`). The other parts of the knowledge a step reads, the use
 * cases take by their own types.
 */

/**
 * What an agent is told of the knowledge, from `@nightshift/agents`.
 * @filledBy agents
 */
export type StepBrief = {
	/** `NS_KNOWLEDGE` for the folder. */
	env(folder: string): Record<string, string>;
	/**
	 * The session brief for the folder: the line that says where it is, and
	 * the knowledge tools over `tools` in the project only, which tell
	 * `onUse` of each search and read. With `learnings`, the agent may
	 * propose learnings.
	 */
	session(input: {
		folder: string;
		projectId: string;
		tools: KnowledgePort;
		onUse: (projectId: string, use: KnowledgeUse) => void;
		learnings: boolean;
	}): SessionContribution;
};
