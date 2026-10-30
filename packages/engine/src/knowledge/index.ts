/** Knowledge: a project's folder of files an agent may read, on each Device, outside the repository. */

export {
	createKnowledgeFolders,
	KNOWLEDGE_FILES_WARNING,
	type KnowledgeFile,
	type KnowledgeFolders,
} from "./folder";
export {
	commandKnowledge,
	type KnowledgeRequest,
	sessionKnowledge,
} from "./handoff";
