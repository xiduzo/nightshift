import { INDEX_FILE, type KnowledgeFolders } from "./folder";

/**
 * How a step gets the project's knowledge folder, on the Device that runs
 * it. Every Command and every Agent session gets its path in
 * `NS_KNOWLEDGE`, so a sync kit knows where to write. An agent also gets
 * the folder to read (`addDirs`) and one line that says where it is, when
 * the folder has files or its node asks for it.
 */

/** The environment variable with the folder's path. */
export const KNOWLEDGE_ENV = "NS_KNOWLEDGE";

/** What a step asks of the project's knowledge. */
export type KnowledgeRequest = {
	projectId: string;
	/**
	 * The node asks for the folder (`knowledge: true`): the agent gets it
	 * even when it is empty. Else only when it has files.
	 */
	always?: boolean;
};

/** The line an agent gets next to its prompt. */
export function knowledgeLine(path: string): string {
	return `Project knowledge is in ${path}. Read ${INDEX_FILE} there first, then grep the folder for what you need. Do not change the folder.`;
}

/** The folder in `NS_KNOWLEDGE`, made when it is not there yet. */
export async function commandKnowledge(
	folders: KnowledgeFolders,
	request: KnowledgeRequest,
): Promise<Record<string, string>> {
	return { [KNOWLEDGE_ENV]: await folders.ensure(request.projectId) };
}

/**
 * What an agent session gets: the folder in `NS_KNOWLEDGE`, and, when the
 * folder has files or the node asks for it, the folder to read and the
 * line, with a fresh index.
 */
export async function sessionKnowledge(
	folders: KnowledgeFolders,
	request: KnowledgeRequest,
): Promise<{
	env: Record<string, string>;
	addDirs?: string[];
	instructions?: string;
}> {
	const path = folders.folder(request.projectId);
	const env = { [KNOWLEDGE_ENV]: path };
	const files = await folders.files(request.projectId);
	if (files.length === 0 && !request.always) return { env };
	await folders.index(request.projectId);
	return { env, addDirs: [path], instructions: knowledgeLine(path) };
}
