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
import {
	KNOWLEDGE_TOOLS,
	kilobytes,
	PROJECT_PROPERTY,
	READ_BYTES,
	READ_KNOWLEDGE_TOOL,
	SEARCH_DEFAULT,
	SEARCH_KNOWLEDGE_TOOL,
	SEARCH_MAX,
} from "./brief";

/** A file a search found, at its best section. `match` parts of the excerpt are the words found. */
type KnowledgeToolHit = {
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

/** A file a search returned, as the run's log keeps it: where, not what. */
export type KnowledgeUseHit = {
	path: string;
	section: string | null;
	line: number;
	page: number | null;
	found: ("words" | "meaning")[];
};

/**
 * What an agent did with the knowledge, for the run's log: a search with
 * the files it returned, or a read of one file (`found`: the file was
 * there).
 */
export type KnowledgeUse =
	| { kind: "search"; query: string; hits: KnowledgeUseHit[] }
	| {
			kind: "read";
			path: string;
			found: boolean;
			/** The spot the read started from. Absent: the start of the file. */
			from?: KnowledgeReadFrom;
	  };

/** Where a read starts: a search hit's section, line or page. */
export type KnowledgeReadFrom = {
	section?: string;
	line?: number;
	page?: number;
};

/** One file of the knowledge, its text cut at the size asked for. */
type KnowledgeToolFile = {
	path: string;
	title: string;
	text: string;
	/** Bytes of the whole text. */
	size: number;
	truncated: boolean;
	/** Where the text starts, for a read from a spot. Absent: the start of the file. */
	from?: { line: number; page: number | null };
};

/** What the knowledge tools read: Night Shift on this computer. */
export type KnowledgePort = {
	/** The best files of the project's knowledge for the words, best first. */
	searchKnowledge(
		projectId: string,
		query: string,
		limit: number,
	): Promise<KnowledgeToolHit[]>;
	/** One file of the project's knowledge by its path, from `from` when given. Null: no such file. */
	readKnowledge(
		projectId: string,
		path: string,
		maxBytes: number,
		from?: KnowledgeReadFrom,
	): Promise<KnowledgeToolFile | null>;
};

/** The project a call works in. Without a name, messages say "the project's knowledge". */
type KnowledgeProject = { id: string; name?: string };

/**
 * Where the tools work:
 * - `project`: in that project only. The tools take no `project`.
 * - `projectOf`: the tools take a `project`, and this finds the project
 *   of a call (an id, a name, or the folder the agent works in).
 */
type KnowledgeScope =
	| { project: KnowledgeProject }
	| { projectOf: (args: unknown) => Promise<KnowledgeProject> };

type ToolFields = Record<string, { type: string; description: string }>;

/** The spot a `read_knowledge` call names, from its `section`, `line` and `page`. Undefined: none. */
function spotOf(args: unknown): KnowledgeReadFrom | undefined {
	const section = field(args, "section");
	const line = field(args, "line");
	const page = field(args, "page");
	const whole = (value: unknown) =>
		typeof value === "number" && Number.isInteger(value) && value > 0
			? value
			: undefined;
	const from: KnowledgeReadFrom = {
		...(typeof section === "string" && section.trim() !== ""
			? { section: section.trim().slice(0, 500) }
			: {}),
		...(whole(line) !== undefined ? { line: whole(line) } : {}),
		...(whole(page) !== undefined ? { page: whole(page) } : {}),
	};
	return Object.keys(from).length > 0 ? from : undefined;
}

/** Where a read started, for its first line. */
function spotLine(from: { line: number; page: number | null }): string {
	return from.page !== null
		? `page ${from.page}, line ${from.line}`
		: `line ${from.line}`;
}

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

function knowledgeOf(project: KnowledgeProject): string {
	return project.name
		? `the knowledge of "${project.name}"`
		: "the project's knowledge";
}

/** A search hit as the run's log keeps it. */
export function useHit(hit: KnowledgeToolHit): KnowledgeUseHit {
	return {
		path: hit.path,
		section: hit.section ?? null,
		line: hit.line ?? 1,
		page: hit.page ?? null,
		found: hit.found ?? ["words"],
	};
}

/**
 * The knowledge tools over `port`, in the project(s) of `scope`. `onUse`
 * hears each search and each read once it answered, with its project.
 */
export function knowledgeTools(
	port: KnowledgePort,
	scope: KnowledgeScope,
	options: { onUse?: (projectId: string, use: KnowledgeUse) => void } = {},
): BridgedTool[] {
	const used = (projectId: string, use: KnowledgeUse) => {
		try {
			options.onUse?.(projectId, use);
		} catch (error) {
			// The tool answers the agent all the same.
			console.warn("A use of the knowledge was not kept:", error);
		}
	};
	const chooses = "projectOf" in scope;
	const projectOf = async (args: unknown) =>
		"projectOf" in scope ? scope.projectOf(args) : scope.project;
	const withProject = (properties: ToolFields) =>
		chooses ? { project: PROJECT_PROPERTY, ...properties } : properties;
	return [
		toolDefinition({
			name: SEARCH_KNOWLEDGE_TOOL.name,
			description: SEARCH_KNOWLEDGE_TOOL.description,
			inputSchema: {
				type: "object",
				properties: withProject(SEARCH_KNOWLEDGE_TOOL.properties),
				required: SEARCH_KNOWLEDGE_TOOL.required,
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
			const words = query.trim().slice(0, 1000);
			const hits = await port.searchKnowledge(project.id, words, count);
			used(project.id, {
				kind: "search",
				query: words,
				hits: hits.map(useHit),
			});
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
			name: READ_KNOWLEDGE_TOOL.name,
			description: READ_KNOWLEDGE_TOOL.description,
			inputSchema: {
				type: "object",
				properties: withProject(READ_KNOWLEDGE_TOOL.properties),
				required: READ_KNOWLEDGE_TOOL.required,
			},
		}).server(async (args: unknown) => {
			const path = field(args, "path");
			if (typeof path !== "string" || path.trim() === "") {
				throw new Error(
					"Give the file's path in `path`, as search_knowledge gives it.",
				);
			}
			const project = await projectOf(args);
			const from = spotOf(args);
			const file = await port.readKnowledge(
				project.id,
				path.trim(),
				READ_BYTES,
				from,
			);
			used(project.id, {
				kind: "read",
				path: file?.path ?? path.trim(),
				found: file !== null,
				...(from ? { from } : {}),
			});
			if (!file) {
				const where = knowledgeOf(project);
				return `${where.charAt(0).toUpperCase()}${where.slice(1)} has no file "${path.trim()}". Call ${KNOWLEDGE_TOOLS.searchKnowledge} for the paths.`;
			}
			const where = file.from
				? file.truncated
					? ` This is ${kilobytes(READ_BYTES)} from ${spotLine(file.from)}.`
					: ` This is the text from ${spotLine(file.from)} on.`
				: file.truncated
					? ` This is its first ${kilobytes(READ_BYTES)}.`
					: "";
			const missed =
				from && !file.from
					? ` It has no ${from.section ? `section "${from.section}"` : "such page or line"}: this is its start.`
					: "";
			const head =
				file.truncated || file.from || missed
					? `${file.path}: ${file.title}. The file is ${kilobytes(file.size)}.${where}${missed}`
					: `${file.path}: ${file.title}`;
			return `${head}\n\n${file.text}`;
		}),
	];
}
