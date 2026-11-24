/**
 * Terminal port shapes and project helpers for `nightshift mcp`.
 */

export {
	knowledgeResourceRow,
	mimeOfKnowledgePath,
	parseKnowledgeUri,
} from "./domain/terminal-knowledge";
export type { TerminalProject } from "./domain/terminal-project";
export { chooseProject, projectOfFolder } from "./domain/terminal-project";
export type { TerminalRunPort } from "./domain/terminal-runs";
export {
	costText,
	gateIdOf,
	isoOrNull,
	parseGateId,
	projectProperty,
	RUN_STATUSES,
	RUN_TOOLS,
	reportSection,
	sinceOf,
	sinceProperty,
	statusesOf,
} from "./domain/terminal-runs";
