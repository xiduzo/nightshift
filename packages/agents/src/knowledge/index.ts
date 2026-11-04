/**
 * The knowledge as an agent meets it: the session brief (`brief.ts`) and the
 * tools it reads with (`tools.ts`). The `./tools` entry publishes what the
 * engine needs of it.
 */
export {
	KNOWLEDGE_INDEX_INTRO,
	KNOWLEDGE_TERMINAL_INSTRUCTION,
	knowledgeBrief,
	knowledgeEnv,
	LEARNINGS_FIELD_DESCRIPTION,
	LEARNINGS_RULE,
} from "./brief";
export {
	type KnowledgePort,
	type KnowledgeReadFrom,
	type KnowledgeUse,
	type KnowledgeUseHit,
	knowledgeTools,
	useHit,
} from "./tools";
