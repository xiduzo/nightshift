import type { KnowledgeUse, KnowledgeUseHit } from "@nightshift/agents/tools";
import type { Database } from "@nightshift/db";
import { event } from "@nightshift/db/schema";
import { and, desc, gte, inArray, sql } from "drizzle-orm";
import {
	type EventInput,
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
				payload: { projectId, path: use.path, found: use.found, via },
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
