/** The query options of a project's knowledge (`@nightshift/client`, on this app's client), and its mutations. */

import { createKnowledgeQueries } from "@nightshift/client";
import { orpc } from "@/shared/api";

export const knowledgeQueries = createKnowledgeQueries(orpc);

export const knowledgeMutations = {
	/** Adds a source, or changes one: its flow and its schedule. */
	saveSource: orpc.knowledge.saveSource.mutationOptions,
	/** Removes a source, and its files if asked. */
	removeSource: orpc.knowledge.removeSource.mutationOptions,
	/** Runs a source the page added now, where its schedule runs it. */
	syncSource: orpc.knowledge.syncSource.mutationOptions,
	/** Marks the files that answer a question, or with none takes it out of the set. */
	markQuestion: orpc.knowledge.markQuestion.mutationOptions,
	/** Marks a word as not a topic on the Map, or puts it back. */
	markNotTopic: orpc.knowledge.markNotTopic.mutationOptions,
	/** Turns search by meaning on or off for the project. */
	setMeaning: orpc.knowledge.setMeaning.mutationOptions,
};
