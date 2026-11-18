/** The layout of a project's knowledge folder and the text of a learning's file. It imports no other part of `flows`, so every layer can use it. */

export {
	ACCEPTED_LEARNINGS_DIR,
	IS_PROPOSED_LEARNING_SHELL,
	isHiddenFromReaders,
	isKnowledgeId,
	isKnowledgeOwnFolder,
	isProposedLearning,
	isQuestionSetPath,
	KNOWLEDGE_INDEX_FILE,
	KNOWLEDGE_OWN_FOLDERS,
	KNOWLEDGE_OWN_FOLDERS_WORDS,
	KNOWLEDGE_RECONCILE_FILE,
	KNOWLEDGE_SEARCH_FILE,
	KNOWLEDGE_STAGING_SUFFIX,
	knowledgeFoldersOf,
	NOT_TOPICS_FILE,
	PROPOSED_LEARNINGS_DIR,
	proposedLearningAt,
	proposedLearningFileName,
	proposedLearningOf,
	QUESTION_SET_FILE,
	toldLearningFileName,
} from "./layout";
export {
	formatLearnings,
	formatPersonNote,
	LEARNINGS_GATE_TEXT_AWK,
	learningNotes,
	learningPreface,
	parseLearnings,
	withoutNote,
} from "./learning-file";
