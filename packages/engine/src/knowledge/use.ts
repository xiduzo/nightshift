import type { KnowledgeUse, KnowledgeUseHit } from "@nightshift/agents/tools";
import type { Database } from "@nightshift/db";
import { event } from "@nightshift/db/schema";
import { and, desc, gte, inArray, sql } from "drizzle-orm";
import {
	type EventInput,
	type KnowledgeUseFact,
	type KnowledgeVia,
	parseEventRow,
	type RunLog,
} from "../log";
import { questionKey } from "./questions";

/**
 * How agents use a project's knowledge, from the event log: each search
 * (`KnowledgeSearched`) and each read (`KnowledgeRead`) of an agent. An
 * Agent step logs its own on its step (`StepHandle.usedKnowledge`); the
 * nightshift MCP server's calls are logged with no run (`logKnowledgeUse`).
 */

/** The event of one use of the knowledge, without its run, step or session. */
export function knowledgeUseEvent(
	projectId: string,
	use: KnowledgeUse,
	via: KnowledgeVia,
): EventInput<"KnowledgeSearched"> | EventInput<"KnowledgeRead"> {
	return use.kind === "search"
		? {
				type: "KnowledgeSearched",
				payload: { projectId, query: use.query, hits: use.hits, via },
			}
		: {
				type: "KnowledgeRead",
				payload: {
					projectId,
					path: use.path,
					found: use.found,
					via,
					...(use.from ? { from: use.from } : {}),
				},
			};
}

/** Logs a use of the knowledge through the nightshift MCP server: a fact of the project, with no run. */
export async function logKnowledgeUse(
	log: Pick<RunLog, "append">,
	projectId: string,
	use: KnowledgeUse,
): Promise<void> {
	await log.append(knowledgeUseEvent(projectId, use, "mcp"));
}

/** A question agents asked the knowledge, and what the last asking found. */
export type AskedQuestion = {
	/** As it was asked last. */
	query: string;
	/** How often agents asked it, in the searches read. */
	times: number;
	/** Epoch ms: when it was asked last. */
	lastAt: number;
	/** The run and step that asked it last. Null: through the nightshift MCP server. */
	runId: string | null;
	stepId: string | null;
	/** What the last asking found, best first. */
	hits: KnowledgeUseHit[];
};

/** How many searches the questions read, newest first. */
const ASKED_WINDOW = 2_000;

/** The project's knowledge events, newest first, at most `limit`. */
function projectEvents(
	db: Database,
	projectId: string,
	types: readonly ("KnowledgeSearched" | "KnowledgeRead")[],
	options: { limit: number; since?: number },
) {
	return db
		.select()
		.from(event)
		.where(
			and(
				inArray(event.type, [...types]),
				sql`json_extract(${event.payload}, '$.projectId') = ${projectId}`,
				options.since === undefined
					? undefined
					: gte(event.at, new Date(options.since)),
			),
		)
		.orderBy(desc(event.seq))
		.limit(options.limit)
		.then((rows) => rows.map(parseEventRow));
}

/**
 * The questions agents asked a project's knowledge, newest first, at most
 * `limit`: each question once (`questionKey`), with what its last asking
 * found. From its latest 2 000 searches, in runs and through the MCP server.
 */
export async function askedQuestions(
	db: Database,
	projectId: string,
	options: { limit?: number } = {},
): Promise<AskedQuestion[]> {
	const limit = options.limit ?? 50;
	const rows = await projectEvents(db, projectId, ["KnowledgeSearched"], {
		limit: ASKED_WINDOW,
	});
	const asked = new Map<string, AskedQuestion>();
	for (const row of rows) {
		if (row.type !== "KnowledgeSearched") continue;
		const key = questionKey(row.payload.query);
		const known = asked.get(key);
		if (known) {
			known.times++;
			continue;
		}
		if (asked.size >= limit) continue;
		asked.set(key, {
			query: row.payload.query,
			times: 1,
			lastAt: row.at,
			runId: row.runId,
			stepId: row.stepId,
			hits: row.payload.hits,
		});
	}
	return [...asked.values()];
}

/**
 * A knowledge file an agent of a step used: one it read, or one a search
 * of it put at the top. At the section it read from, else the section the
 * search found.
 */
export type KnowledgeSource = {
	path: string;
	section: string | null;
	page: number | null;
	line: number;
	/** The agent read the file (`read_knowledge`). False: a search put it in its top 3. */
	read: boolean;
};

/** The hits of each search that count as used: the top 3. */
const SOURCE_HITS = 3;
/** The most sources a step lists. */
const MAX_SOURCES = 10;

/**
 * The knowledge files a step's agents used, from its searches and reads
 * (`DerivedStep.knowledge`): the files it read first, in the order it read
 * them, then the top hits of its searches that it did not read. No effort
 * of the agent: it cites nothing itself.
 */
export function stepSources(
	uses: readonly KnowledgeUseFact[],
): KnowledgeSource[] {
	/** Where each path was last found, for a read that names no spot. */
	const foundAt = new Map<string, KnowledgeUseHit>();
	const read = new Map<string, KnowledgeSource>();
	const found = new Map<string, KnowledgeSource>();
	for (const use of uses) {
		if (use.type === "KnowledgeSearched") {
			for (const [i, hit] of use.payload.hits.entries()) {
				foundAt.set(hit.path, hit);
				if (i < SOURCE_HITS && !found.has(hit.path)) {
					found.set(hit.path, {
						path: hit.path,
						section: hit.section,
						page: hit.page,
						line: hit.line,
						read: false,
					});
				}
			}
			continue;
		}
		const { path, found: there, from } = use.payload;
		if (!there || read.has(path)) continue;
		const hit = foundAt.get(path);
		read.set(path, {
			path,
			section: from ? (from.section ?? null) : (hit?.section ?? null),
			page: from ? (from.page ?? null) : (hit?.page ?? null),
			line: from ? (from.line ?? 1) : (hit?.line ?? 1),
			read: true,
		});
	}
	return [
		...read.values(),
		...[...found.values()].filter((source) => !read.has(source.path)),
	].slice(0, MAX_SOURCES);
}

/** How agents used one file of the knowledge. */
export type KnowledgeFileUse = {
	path: string;
	/** Searches that returned it in their top 5. */
	found: number;
	/** Reads of it that found it. */
	read: number;
	/** Epoch ms: its latest use. */
	lastAt: number;
	/** Epoch ms: its latest use in a run. Null: none in the window. */
	lastRunAt: number | null;
};

/** How agents used a project's knowledge, file by file. */
export type KnowledgeUseReport = {
	/** Epoch ms: the uses counted start here. */
	since: number;
	/** A file no run used for this long is marked, in days. */
	unusedDays: number;
	/** Whether any run used the knowledge since `now - unusedDays`: else no file is marked. */
	runsUsedIt: boolean;
	files: KnowledgeFileUse[];
};

const DAY = 24 * 60 * 60 * 1000;
/** How far back the use counts. */
const USE_WINDOW_DAYS = 90;
/** The most events the use reads, newest first. */
const USE_EVENTS = 20_000;
/** A search counts as finding a file in its top this many. */
const FOUND_IN_TOP = 5;
/** A file no run used for this long is marked: a source may sync it for nothing. */
export const UNUSED_DAYS = 30;

/**
 * How often agents found and read each file of a project's knowledge in
 * the last 90 days, in runs and through the MCP server, and when a run
 * last used it. The Knowledge page marks the files no run used in 30
 * days, once runs use the knowledge at all.
 */
export async function knowledgeFileUse(
	db: Database,
	projectId: string,
	now: number = Date.now(),
): Promise<KnowledgeUseReport> {
	const since = now - USE_WINDOW_DAYS * DAY;
	const rows = await projectEvents(
		db,
		projectId,
		["KnowledgeSearched", "KnowledgeRead"],
		{ limit: USE_EVENTS, since },
	);
	const files = new Map<string, KnowledgeFileUse>();
	const use = (path: string, at: number, inRun: boolean) => {
		let file = files.get(path);
		if (!file) {
			file = { path, found: 0, read: 0, lastAt: at, lastRunAt: null };
			files.set(path, file);
		}
		file.lastAt = Math.max(file.lastAt, at);
		if (inRun) file.lastRunAt = Math.max(file.lastRunAt ?? at, at);
		return file;
	};
	const recent = now - UNUSED_DAYS * DAY;
	let runsUsedIt = false;
	for (const row of rows) {
		const inRun = row.runId !== null;
		if (inRun && row.at >= recent) runsUsedIt = true;
		if (row.type === "KnowledgeSearched") {
			for (const hit of row.payload.hits.slice(0, FOUND_IN_TOP)) {
				use(hit.path, row.at, inRun).found++;
			}
		} else if (row.type === "KnowledgeRead" && row.payload.found) {
			use(row.payload.path, row.at, inRun).read++;
		}
	}
	return {
		since,
		unusedDays: UNUSED_DAYS,
		runsUsedIt,
		files: [...files.values()].sort((a, b) => a.path.localeCompare(b.path)),
	};
}
