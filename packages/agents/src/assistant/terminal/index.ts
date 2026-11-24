/**
 * The project and the knowledge files for `nightshift mcp`.
 */

export {
	type KnowledgeResource,
	knowledgeResourceRow,
	mimeOfKnowledgePath,
	parseKnowledgeUri,
} from "./domain/terminal-knowledge";
export type { TerminalProject } from "./domain/terminal-project";
export { chooseProject, projectOfFolder } from "./domain/terminal-project";
