/**
 * The knowledge side of `nightshift mcp`: keyword search over a project's
 * knowledge on this computer (`search_knowledge`), and reading one file of
 * it (`read_knowledge`). The knowledge is the files besides the code that
 * agents read: a wiki, web pages, work items. The tools read through the
 * same procedures as the Knowledge page, over a `TerminalKnowledgePort`.
 */
import { toolDefinition } from "@tanstack/ai";
import type { BridgedTool } from "../port";
import type { TerminalProject } from "./terminal-project";
import { field } from "./tools";

/** The names of the knowledge tools. */
export const KNOWLEDGE_TOOLS = {
	searchKnowledge: "search_knowledge",
	readKnowledge: "read_knowledge",
} as const;

/** A file a search found. `match` parts of the excerpt are the words found. */
export type TerminalKnowledgeHit = {
	path: string;
	title: string;
	snippet: { text: string; match: boolean }[];
};

/** One file of the knowledge, its text cut at the size asked for. */
export type TerminalKnowledgeFile = {
	path: string;
	title: string;
	text: string;
	/** Bytes of the whole file. */
	size: number;
	truncated: boolean;
};

/** What the knowledge tools read: Night Shift on this computer. */
export type TerminalKnowledgePort = {
	/** The best files of the project's knowledge for the words, best first. */
	searchKnowledge(
		projectId: string,
		query: string,
		limit: number,
	): Promise<TerminalKnowledgeHit[]>;
	/** One file of the project's knowledge by its path. Null: no such file. */
	readKnowledge(
		projectId: string,
		path: string,
		maxBytes: number,
	): Promise<TerminalKnowledgeFile | null>;
};

const SEARCH_DEFAULT = 10;
const SEARCH_MAX = 50;
/** What `read_knowledge` returns of a file: enough for a page, not a book. */
const READ_BYTES = 100 * 1024;

const projectProperty = {
	type: "string",
	description:
		"The project: its id or name from list_projects. Leave it out for the project of the folder you work in.",
};

/** An excerpt with the words found in **bold**. */
function excerpt(hit: TerminalKnowledgeHit): string {
	return hit.snippet
		.map((part) => (part.match ? `**${part.text}**` : part.text))
		.join("");
}

function kilobytes(bytes: number): string {
	return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** The knowledge tools over `port`, in the project `projectOf` finds for a call. */
export function terminalKnowledgeTools(
	port: TerminalKnowledgePort,
	projectOf: (args: unknown) => Promise<TerminalProject>,
): BridgedTool[] {
	return [
		toolDefinition({
			name: KNOWLEDGE_TOOLS.searchKnowledge,
			description:
				"Search the project's knowledge by keyword: the files besides the code that agents read, such as a wiki, web pages or work items. Returns the best files first, each with its path, title and an excerpt with the words found in bold. Every word must match, else some of them. Keep a phrase together in quotes. End a word with * to match its start. Read a whole file with read_knowledge.",
			inputSchema: {
				type: "object",
				properties: {
					project: projectProperty,
					query: {
						type: "string",
						description:
							'The words to look for. Example: deploy "release notes" config*',
					},
					limit: {
						type: "number",
						description: `At most this many files. Default ${SEARCH_DEFAULT}, at most ${SEARCH_MAX}.`,
					},
				},
				required: ["query"],
			},
		}).server(async (args: unknown) => {
			const query = field(args, "query");
			if (typeof query !== "string" || query.trim() === "") {
				throw new Error("Give the words to look for in `query`.");
			}
			const limit = field(args, "limit");
			const count =
				typeof limit === "number" && Number.isInteger(limit) && limit > 0
					? Math.min(limit, SEARCH_MAX)
					: SEARCH_DEFAULT;
			const project = await projectOf(args);
			const hits = await port.searchKnowledge(
				project.id,
				query.trim().slice(0, 1000),
				count,
			);
			if (hits.length === 0) {
				return `No file in the knowledge of "${project.name}" matches ${JSON.stringify(query.trim())}. Try other words, or fewer.`;
			}
			return JSON.stringify(
				hits.map((hit) => ({
					path: hit.path,
					title: hit.title,
					excerpt: excerpt(hit),
				})),
				null,
				2,
			);
		}),
		toolDefinition({
			name: KNOWLEDGE_TOOLS.readKnowledge,
			description: `Read one file of the project's knowledge by its path, as search_knowledge gives it. Returns its text, at most the first ${kilobytes(READ_BYTES)}.`,
			inputSchema: {
				type: "object",
				properties: {
					project: projectProperty,
					path: {
						type: "string",
						description:
							"The file's path in the knowledge, from search_knowledge. Example: wiki/Home.md",
					},
				},
				required: ["path"],
			},
		}).server(async (args: unknown) => {
			const path = field(args, "path");
			if (typeof path !== "string" || path.trim() === "") {
				throw new Error(
					"Give the file's path in `path`, as search_knowledge gives it.",
				);
			}
			const project = await projectOf(args);
			const file = await port.readKnowledge(
				project.id,
				path.trim(),
				READ_BYTES,
			);
			if (!file) {
				return `The knowledge of "${project.name}" has no file "${path.trim()}". Call ${KNOWLEDGE_TOOLS.searchKnowledge} for the paths.`;
			}
			const head = file.truncated
				? `${file.path}: ${file.title}. The file is ${kilobytes(file.size)}. This is its first ${kilobytes(READ_BYTES)}.`
				: `${file.path}: ${file.title}`;
			return `${head}\n\n${file.text}`;
		}),
	];
}
