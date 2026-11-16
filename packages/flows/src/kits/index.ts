/** Kits: flows that ship with Night Shift, read only, run by a Call node. */

export {
	folderKit,
	isKitName,
	isKnowledgeKit,
	type Kit,
	kitCopyName,
	kitFlow,
	kitList,
	knowledgeKitsOf,
	REVIEW_LEARNINGS_KIT,
} from "./kits";
export {
	ACCEPTED_LEARNINGS_DIR,
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
	NOT_TOPICS_FILE,
	PROPOSED_LEARNINGS_DIR,
	proposedLearningAt,
	proposedLearningFileName,
	proposedLearningOf,
	QUESTION_SET_FILE,
	toldLearningFileName,
} from "./knowledge/layout";
export {
	formatLearnings,
	formatPersonNote,
	learningNotes,
	learningPreface,
	parseLearnings,
	withoutNote,
} from "./knowledge/learning-file";
export {
	DEFAULT_PAGE_READER,
	PAGE_READ_HEADER,
	PAGE_READER_DEFAULTS,
	PAGE_READER_ENV,
	type PageReaderSetting,
	pageReaderSettingSchema,
} from "./knowledge/readers";
export {
	KNOWLEDGE_SOURCE_KINDS,
	type KnowledgeSourceKit,
	knowledgeSourceKind,
	knowledgeSourceKitSchema,
} from "./knowledge/source-kits";
export {
	type KnowledgeSource,
	knowledgeKitInputs,
	knowledgeSourceBracesProblem,
	knowledgeSourceFields,
	knowledgeSourceSchema,
} from "./knowledge/sources";
export { KNOWLEDGE_FOLDER_INPUT } from "./knowledge/sync-kit";
