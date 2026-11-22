/**
 * The knowledge as an agent meets it: the session brief (`domain/brief.ts`)
 * and the tools it reads with (`domain/tools.ts`), as rules alone. A tool is
 * a spec: `asBridgedTools` of `@nightshift/agents/tools` makes the tools a
 * session takes. It is the `./knowledge` entry of the package too.
 */
export {
	KNOWLEDGE_INDEX_INTRO,
	KNOWLEDGE_TERMINAL_INSTRUCTION,
	knowledgeBrief,
	knowledgeEnv,
} from "./domain/brief";
export {
	type KnowledgePort,
	type KnowledgeReadFrom,
	type KnowledgeUse,
	type KnowledgeUseHit,
	knowledgeTools,
	useHit,
} from "./domain/tools";
