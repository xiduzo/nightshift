/** The knowledge kits: the layout of a project's knowledge folder, the page reader setting, the Knowledge sources and the kits that fill and review the folder. */

export {
	ACCEPTED_LEARNINGS_DIR,
	formatLearnings,
	formatPersonNote,
	isHiddenFromReaders,
	isKnowledgeId,
	isKnowledgeOwnFolder,
	isProposedLearning,
	isQuestionSetPath,
	KNOWLEDGE_INDEX_FILE,
	KNOWLEDGE_OWN_FOLDERS_WORDS,
	KNOWLEDGE_RECONCILE_FILE,
	KNOWLEDGE_SEARCH_FILE,
	KNOWLEDGE_STAGING_SUFFIX,
	knowledgeFoldersOf,
	learningNotes,
	learningPreface,
	NOT_TOPICS_FILE,
	PROPOSED_LEARNINGS_DIR,
	parseLearnings,
	proposedLearningAt,
	proposedLearningFileName,
	proposedLearningOf,
	QUESTION_SET_FILE,
	toldLearningFileName,
	withoutNote,
} from "./layout";
export {
	DEFAULT_PAGE_READER,
	PAGE_READ_HEADER,
	PAGE_READER_DEFAULTS,
	PAGE_READER_ENV,
	type PageReaderSetting,
	pageReaderSettingSchema,
} from "./readers";
export { knowledgeReviewLearningsKit } from "./review-learnings";
export {
	KNOWLEDGE_SOURCE_KINDS,
	KNOWLEDGE_SYNC_KITS,
	type KnowledgeSourceKit,
	knowledgeSourceKind,
	knowledgeSourceKitSchema,
} from "./source-kits";
export { KNOWLEDGE_FOLDER_INPUT } from "./sync-kit";
export { WEB_MAX_PAGES } from "./web-source";
