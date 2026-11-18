import { knowledgeFiles } from "./files";
import { knowledgeLearnings } from "./learnings";
import { knowledgeMap } from "./map";
import { knowledgeOverview } from "./overview";
import { knowledgeQuestions } from "./questions";
import { knowledgeSearch } from "./search";
import { knowledgeSources } from "./sources";

/**
 * A project's knowledge belongs to its Space (ADR 4): every Member of the
 * Space reads it, on any of its Devices and on its Host. A browser changes
 * it only through flows (the syncs) and the review of learnings. Each
 * procedure keyed by a project checks it is the Space's first
 * (`projectProcedure`).
 *
 * The procedures are in the file of what they are about. This table gives
 * each one its name on the wire (`knowledge.get`). The OpenAPI document
 * and the router's type list the procedures in the order of the table.
 */
export const knowledge = {
	get: knowledgeOverview.get,
	review: knowledgeOverview.review,
	files: knowledgeFiles.files,
	learnings: knowledgeLearnings.learnings,
	keepLearning: knowledgeLearnings.keepLearning,
	deleteLearning: knowledgeLearnings.deleteLearning,
	settleNote: knowledgeLearnings.settleNote,
	tell: knowledgeLearnings.tell,
	saveSource: knowledgeSources.saveSource,
	removeSource: knowledgeSources.removeSource,
	syncSource: knowledgeSources.syncSource,
	search: knowledgeSearch.search,
	meaning: knowledgeSearch.meaning,
	read: knowledgeFiles.read,
	questions: knowledgeQuestions.questions,
	graph: knowledgeMap.graph,
	markNotTopic: knowledgeMap.markNotTopic,
	markQuestion: knowledgeQuestions.markQuestion,
	evaluate: knowledgeQuestions.evaluate,
	setMeaning: knowledgeSearch.setMeaning,
	setLearnsFromRuns: knowledgeLearnings.setLearnsFromRuns,
	setReader: knowledgeSources.setReader,
	look: knowledgeSources.look,
	use: knowledgeFiles.use,
};
