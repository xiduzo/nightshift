import {
	knowledgeBrief,
	knowledgeEnv,
	knowledgeTools,
} from "@nightshift/agents/knowledge";
import { asBridgedTools } from "@nightshift/agents/tools";
import type {
	CommandKnowledge,
	KnowledgeRequest,
	SessionKnowledge,
	SessionStep,
} from "../../contract";
import type { ReaderSecret } from "../readers";
import { openCommandKnowledge } from "./application/open-command-knowledge";
import { openSessionKnowledge } from "./application/open-session-knowledge";
import type {
	StepBrief,
	StepFiles,
	StepFolders,
	StepHolds,
	StepLearnings,
	StepPageReaders,
	StepReader,
	StepSearch,
} from "./application/ports";

/**
 * The wiring of knowledge/steps: the one place that fills its ports and
 * binds each use case to them.
 */

/** What the knowledge gives knowledge/steps: the parts of it a step reads. */
export type StepsDeps = {
	folders: StepFolders;
	/** The index and the views of the folders. */
	files: StepFiles;
	reconciler: StepHolds;
	reader: StepReader;
	search: StepSearch;
	learnings: StepLearnings;
	/** The page readers: a Command step gets the project's. Without them, none. */
	readers?: StepPageReaders;
};

/** What a step gets of the knowledge, bound to the ports: `Knowledge.forCommand` and `Knowledge.forSession`. */
export type Steps = {
	/** A Command step starts (`openCommandKnowledge`). */
	forCommand(
		projectId: string,
		step?: { secret?: ReaderSecret },
	): Promise<CommandKnowledge>;
	/** An Agent session starts (`openSessionKnowledge`). */
	forSession(
		request: KnowledgeRequest,
		step?: SessionStep,
	): Promise<SessionKnowledge>;
};

/** The brief of `@nightshift/agents`: the env, and the tools as a session takes them. */
const brief: StepBrief = {
	env: knowledgeEnv,
	session: ({ folder, projectId, tools, onUse, learnings }) =>
		knowledgeBrief({
			folder,
			tools: asBridgedTools(
				knowledgeTools(tools, { project: { id: projectId } }, { onUse }),
			),
			learnings,
		}),
};

export function wireSteps(deps: StepsDeps): Steps {
	const ports = {
		holds: deps.reconciler,
		folders: deps.folders,
		files: deps.files,
		reader: deps.reader,
		search: deps.search,
		learnings: deps.learnings,
		...(deps.readers ? { readers: deps.readers } : {}),
		brief,
	};
	const command = openCommandKnowledge(ports);
	const session = openSessionKnowledge(ports);
	return {
		forCommand: (projectId, step = {}) =>
			command({
				projectId,
				...(step.secret ? { secret: step.secret } : {}),
			}),
		forSession: (request, step) =>
			session({ request, ...(step ? { step } : {}) }),
	};
}
