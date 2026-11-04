/**
 * The session brief: what an agent is told about the project's knowledge,
 * all of it in one module. `brief.test.ts` shows the result on each harness.
 *
 * A step gets it from `knowledgeBrief`, as a `SessionContribution` that the
 * Device folds like any other. The text the others read:
 * - `tools.ts`: the tools' names, descriptions and fields. It keeps what the
 *   tools answer at a call, next to the code that decides that answer.
 * - `session/step-report.ts`: the rule and the field for `learnings`.
 * - the engine's `knowledge/folder.ts`: the first line of `INDEX.md`. It keeps
 *   the format of the lines under it.
 * - `nightshift mcp` in `apps/server`: its sentences about the knowledge. It
 *   keeps the rest of what that server tells an agent in a terminal.
 *
 * One text stays out, by the layer rule. `flows/assistant/guide.ts` says what
 * the `knowledge` field of a node does, and that package sits below this one.
 * It speaks to the assistant that writes a flow, not to the agent of a step.
 */
import { KNOWLEDGE_INDEX_FILE } from "@nightshift/flows";
import type { BridgedTool, SessionContribution } from "../port";

/** The names of the knowledge tools. */
export const KNOWLEDGE_TOOLS = {
	searchKnowledge: "search_knowledge",
	readKnowledge: "read_knowledge",
} as const;

export const SEARCH_DEFAULT = 10;
export const SEARCH_MAX = 50;
/** What `read_knowledge` returns of a file: enough for a page, not a book. */
export const READ_BYTES = 100 * 1024;

export function kilobytes(bytes: number): string {
	return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** What an Agent step is told when it gets the knowledge tools. */
const KNOWLEDGE_TOOLS_INSTRUCTION = `To find something in the project knowledge, call \`${KNOWLEDGE_TOOLS.searchKnowledge}\` with a few keywords or a question. It finds sections of files by their words, and by their meaning when this computer can. PDF and Word files too. Then read a file it gives with \`${KNOWLEDGE_TOOLS.readKnowledge}\`: give the hit's section, page or line to read from there.`;

type JsonSchemaProperty = { type: string; description: string };

/** The field a tool has only where it can work in more than one project. */
export const PROJECT_PROPERTY: JsonSchemaProperty = {
	type: "string",
	description:
		"The project: its id or name from list_projects. Leave it out for the project of the folder you work in.",
};

export const SEARCH_KNOWLEDGE_TOOL = {
	name: KNOWLEDGE_TOOLS.searchKnowledge,
	description:
		"Search the project's knowledge: the files besides the code that agents read, such as a wiki, web pages, work items, PDF and Word files. It finds by keyword, and also by meaning when this computer can, so a question in other words finds an answer too. Returns the best files first, each with its path, title, the section (its heading and line, and page for a PDF) and an excerpt with the words found in bold. Every word must match, else some of them. Keep a phrase together in quotes. End a word with * to match its start. Read a file with read_knowledge: give it the hit's section, page or line to read from there.",
	properties: {
		query: {
			type: "string",
			description:
				'The words to look for. Example: deploy "release notes" config*',
		},
		limit: {
			type: "number",
			description: `At most this many files. Default ${SEARCH_DEFAULT}, at most ${SEARCH_MAX}.`,
		},
	} satisfies Record<string, JsonSchemaProperty>,
	required: ["query"],
};

export const READ_KNOWLEDGE_TOOL = {
	name: KNOWLEDGE_TOOLS.readKnowledge,
	description: `Read one file of the project's knowledge by its path, as search_knowledge gives it. Returns its text, at most ${kilobytes(READ_BYTES)}: from the start, or from the section, page or line of a search hit when you give them. For a PDF or Word file, the text in it.`,
	properties: {
		path: {
			type: "string",
			description:
				"The file's path in the knowledge, from search_knowledge. Example: wiki/Home.md",
		},
		section: {
			type: "string",
			description:
				"Start at this section: its heading, as search_knowledge gives it. Example: Rolling updates",
		},
		page: {
			type: "number",
			description: "Start at this page of a PDF, from search_knowledge.",
		},
		line: {
			type: "number",
			description:
				"Start at this line, from search_knowledge: of the file, or of the page you give.",
		},
	} satisfies Record<string, JsonSchemaProperty>,
	required: ["path"],
};

/** One sentence of the report's instruction, only for an agent that may propose learnings. */
export const LEARNINGS_RULE =
	"If you learned something about this project that would help the next agent, add it to `learnings`: a list of short notes. Leave it out otherwise.";

/** The report's `learnings` field, in its schema. */
export const LEARNINGS_FIELD_DESCRIPTION =
	"Optional. Short notes about this project that would help the next agent. Leave it out when you have none.";

/**
 * The first line of the index's text: an index without it is written again.
 * Change it when the format of the lines changes, so each computer writes its
 * index again.
 */
export const KNOWLEDGE_INDEX_INTRO =
	"Night Shift writes this file. One line per file: its path, title, first sentence and the day it last changed. PDF and Word files too. Under the line of a large markdown file: its headings. Read a file, or grep the folder, for more.";

/** What `nightshift mcp` tells an agent in a terminal about the knowledge. */
export const KNOWLEDGE_TERMINAL_INSTRUCTION =
	"search_knowledge finds files in the project's knowledge by keyword, and by meaning when this computer can: the wiki, pages and notes besides the code. read_knowledge reads one of them, and each file is a resource too. The tools work in the project of the folder you work in, or the one you name in `project` (list_projects).";

/** The environment variable with the folder's path: a step of any kind gets it. */
export function knowledgeEnv(folder: string): Record<string, string> {
	return { NS_KNOWLEDGE: folder };
}

/**
 * What an agent gets when it reads the knowledge in `folder`: the folder, one
 * line that says where it is, the tools with what they are for, and the
 * `learnings` of its report when `learnings` is on.
 */
export function knowledgeBrief(input: {
	folder: string;
	tools: readonly BridgedTool[];
	learnings: boolean;
}) {
	const { folder, tools, learnings } = input;
	return {
		env: knowledgeEnv(folder),
		addDirs: [folder],
		instructions: `Project knowledge is in ${folder}. Read ${KNOWLEDGE_INDEX_FILE} there first, then grep the folder for what you need. Do not change the folder.`,
		tools,
		toolsInstruction: KNOWLEDGE_TOOLS_INSTRUCTION,
		...(learnings ? { report: { learnings: true } } : {}),
	} satisfies SessionContribution;
}
