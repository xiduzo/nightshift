import type { KnowledgeUse } from "@nightshift/agents/knowledge";
import type { AgentEvent, SessionContribution } from "@nightshift/agents/types";

/**
 * What a step gets of the project's knowledge, and how it gives it back
 * (`Knowledge.forCommand`, `Knowledge.forSession`).
 */

/**
 * What an Agent session asks of the project's knowledge, as the wire has it.
 * Neither field: the node turned it off (`knowledge: false`).
 */
export type KnowledgeRequest = {
	/**
	 * The whole folder. `always`: the node asks for it (`knowledge: true`),
	 * so the agent gets it even when it is empty. Else only when it has files.
	 */
	knowledge?: { projectId: string; always?: boolean };
	/**
	 * The node lists folders of the knowledge (`knowledge: [...]`): the agent
	 * gets a view of those only (`view.ts`), even when it is empty. Its search
	 * and reads find nothing else. A field of its own, not part of `knowledge`:
	 * a Device that does not know it gives no knowledge, never the whole folder.
	 */
	knowledgeOnly?: { projectId: string; folders: string[] };
};

/**
 * What a Command step gets: the folder in `NS_KNOWLEDGE`, and the project's
 * page reader in `NS_READER_URL` and `NS_READER_TOKEN` (ADR 39).
 */
export type CommandKnowledge = {
	env: Record<string, string>;
	/** The step ended: what it wrote goes to the Space. */
	done(): Promise<void>;
};

/** What an Agent session gets. */
export type SessionKnowledge = Pick<CommandKnowledge, "done"> & {
	/** What the session gets: `NS_KNOWLEDGE`, and the brief when the agent reads the folder. */
	contribution: SessionContribution;
	/**
	 * The session's events as they are, its learnings kept as proposed learnings of
	 * the run, and each use of the knowledge tools before the next event.
	 */
	events(
		events: AsyncIterable<AgentEvent>,
	): AsyncIterable<AgentEvent | KnowledgeUseEvent>;
};

/** The step an Agent session runs for. */
export type SessionStep = {
	runId?: string;
	/** The step of the run: its proposed learnings have a file of their own. */
	stepId?: string;
};

/**
 * The agent of a session searched or read the project's knowledge, with
 * its tools: the step logs it (`KnowledgeSearched`, `KnowledgeRead`).
 */
export type KnowledgeUseEvent = {
	type: "knowledge";
	projectId: string;
	use: KnowledgeUse;
};
