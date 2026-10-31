/**
 * The knowledge tools: search over a project's knowledge on this computer,
 * by keyword and by meaning when it can (`search_knowledge`), and reading one file of it
 * (`read_knowledge`). The knowledge is the files besides the code that
 * agents read: a wiki, web pages, work items, PDF and Word files.
 *
 * Two sessions get them, over a `KnowledgePort`:
 * - an agent in a terminal (`nightshift mcp`): the tools take a `project`
 *   and read through the same procedures as the Knowledge page;
 * - an Agent step whose knowledge is on: the tools work in the run's
 *   project only, over this Device's own index, bridged into the session
 *   like `report_step`.
 */
import { toolDefinition } from "@tanstack/ai";
import type { BridgedTool } from "../port";

/** The names of the knowledge tools. */
export const KNOWLEDGE_TOOLS = {
	searchKnowledge: "search_knowledge",
	readKnowledge: "read_knowledge",
} as const;

/** What an Agent step is told when it gets the knowledge tools. */
export const KNOWLEDGE_TOOLS_INSTRUCTION = `To find something in the project knowledge, call \`${KNOWLEDGE_TOOLS.searchKnowledge}\` with a few keywords or a question. It finds sections of files by their words, and by their meaning when this computer can. PDF and Word files too. Then read a file it gives with \`${KNOWLEDGE_TOOLS.readKnowledge}\`.`;

/** A file a search found, at its best section. `match` parts of the excerpt are the words found. */
export type KnowledgeToolHit = {
	path: string;
	title: string;
	/** The heading of the section. Null or absent: none. */
	section?: string | null;
	/** The line where the section starts, from 1: of the file, or of its page. */
	line?: number;
	/** The page of a PDF the section is on. */
	page?: number | null;
	snippet: { text: string; match: boolean }[];
	/** How the search found it. Only by meaning: the excerpt has no bold words. */
	found?: ("words" | "meaning")[];
};

/** One file of the knowledge, its text cut at the size asked for. */
export type KnowledgeToolFile = {
	path: string;
	title: string;
	text: string;
	/** Bytes of the whole text. */
	size: number;
	truncated: boolean;
};

/** What the knowledge tools read: Night Shift on this computer. */
export type KnowledgePort = {
	/** The best files of the project's knowledge for the words, best first. */
	searchKnowledge(
		projectId: string,
		query: string,
		limit: number,
	): Promise<KnowledgeToolHit[]>;
	/** One file of the project's knowledge by its path. Null: no such file. */
	readKnowledge(
		projectId: string,
		path: string,
		maxBytes: number,
	): Promise<KnowledgeToolFile | null>;
};

/** The project a call works in. Without a name, messages say "the project's knowledge". */
export type KnowledgeProject = { id: string; name?: string };

/**
 * Where the tools work:
 * - `project`: in that project only. The tools take no `project`.
 * - `projectOf`: the tools take a `project`, and this finds the project
 *   of a call (an id, a name, or the folder the agent works in).
 */
export type KnowledgeScope =
	| { project: KnowledgeProject }
	| { projectOf: (args: unknown) => Promise<KnowledgeProject> };

const SEARCH_DEFAULT = 10;
const SEARCH_MAX = 50;
/** What `read_knowledge` returns of a file: enough for a page, not a book. */
const READ_BYTES = 100 * 1024;

type JsonSchemaProperty = { type: string; description: string };

const projectProperty: JsonSchemaProperty = {
	type: "string",
	description:
		"The project: its id or name from list_projects. Leave it out for the project of the folder you work in.",
};

function field(args: unknown, key: string): unknown {
	return typeof args === "object" && args !== null
		? (args as Record<string, unknown>)[key]
		: undefined;
}

/** An excerpt with the words found in **bold**. */
function excerpt(hit: KnowledgeToolHit): string {
	return hit.snippet
		.map((part) => (part.match ? `**${part.text}**` : part.text))
		.join("");
}

function kilobytes(bytes: number): string {
	return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function knowledgeOf(project: KnowledgeProject): string {
	return project.name
		? `the knowledge of "${project.name}"`
		: "the project's knowledge";
}

/** The knowledge tools over `port`, in the project(s) of `scope`. */
export function knowledgeTools(
	port: KnowledgePort,
	scope: KnowledgeScope,
): BridgedTool[] {
	const chooses = "projectOf" in scope;
	const projectOf = async (args: unknown) =>
		"projectOf" in scope ? scope.projectOf(args) : scope.project;
	const withProject = (properties: Record<string, JsonSchemaProperty>) =>
		chooses ? { project: projectProperty, ...properties } : properties;
	return [
		toolDefinition({
			name: KNOWLEDGE_TOOLS.searchKnowledge,
			description:
				"Search the project's knowledge: the files besides the code that agents read, such as a wiki, web pages, work items, PDF and Word files. It finds by keyword, and also by meaning when this computer can, so a question in other words finds an answer too. Returns the best files first, each with its path, title, the section (its heading and line, and page for a PDF) and an excerpt with the words found in bold. Every word must match, else some of them. Keep a phrase together in quotes. End a word with * to match its start. Read a whole file with read_knowledge.",
			inputSchema: {
				type: "object",
				properties: withProject({
					query: {
						type: "string",
						description:
							'The words to look for. Example: deploy "release notes" config*',
					},
					limit: {
						type: "number",
						description: `At most this many files. Default ${SEARCH_DEFAULT}, at most ${SEARCH_MAX}.`,
					},
				}),
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
				return `No file in ${knowledgeOf(project)} matches ${JSON.stringify(query.trim())}. Try other words, or fewer.`;
			}
			return JSON.stringify(
				hits.map((hit) => ({
					path: hit.path,
					title: hit.title,
					...(hit.section ? { section: hit.section } : {}),
					...(hit.page ? { page: hit.page } : {}),
					...(hit.line !== undefined && hit.line > 1 ? { line: hit.line } : {}),
					...(hit.found?.length === 1 && hit.found[0] === "meaning"
						? { foundBy: "meaning" }
						: {}),
					excerpt: excerpt(hit),
				})),
				null,
				2,
			);
		}),
		toolDefinition({
			name: KNOWLEDGE_TOOLS.readKnowledge,
			description: `Read one file of the project's knowledge by its path, as search_knowledge gives it. Returns its text, at most the first ${kilobytes(READ_BYTES)}. For a PDF or Word file, the text in it.`,
			inputSchema: {
				type: "object",
				properties: withProject({
					path: {
						type: "string",
						description:
							"The file's path in the knowledge, from search_knowledge. Example: wiki/Home.md",
					},
				}),
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
				const where = knowledgeOf(project);
				return `${where.charAt(0).toUpperCase()}${where.slice(1)} has no file "${path.trim()}". Call ${KNOWLEDGE_TOOLS.searchKnowledge} for the paths.`;
			}
			const head = file.truncated
				? `${file.path}: ${file.title}. The file is ${kilobytes(file.size)}. This is its first ${kilobytes(READ_BYTES)}.`
				: `${file.path}: ${file.title}`;
			return `${head}\n\n${file.text}`;
		}),
	];
}
