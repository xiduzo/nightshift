import { createDb } from "@nightshift/db";
import {
	agentSession,
	clone,
	event,
	project,
	run,
	step,
} from "@nightshift/db/schema";
import { asc, eq } from "drizzle-orm";

import { parseEventRow, type TranscriptEntry } from "../log";
import { bundle, transcript } from "../read/run-bundle";

/** The content of a run bundle that `exportRun` wrote, for the round trip. */
export async function openRunBundle(path: string) {
	const db = createDb({ DATABASE_URL: `file:${path}` }, { singleFile: true });
	const facts = new Map(
		(await db.select().from(bundle)).map((row) => [
			row.key,
			JSON.parse(row.value) as unknown,
		]),
	);
	const [runRow] = await db.select().from(run);
	if (!runRow) throw new Error(`${path} has no run.`);
	const [projectRow] = await db.select().from(project);
	return {
		meta: {
			formatVersion: facts.get("format_version"),
			exportedAt: facts.get("exported_at"),
			runId: facts.get("run_id"),
			schema: facts.get("schema"),
			missingTranscripts: facts.get("missing_transcripts"),
			redacted: facts.get("redacted"),
		},
		project: projectRow ?? null,
		clones: await db.select().from(clone),
		run: runRow,
		steps: await db.select().from(step).orderBy(asc(step.createdAt)),
		sessions: await db
			.select()
			.from(agentSession)
			.orderBy(asc(agentSession.createdAt)),
		/** The run's events, oldest first, ready for `foldRun`. */
		events: (await db.select().from(event).orderBy(asc(event.seq))).map(
			parseEventRow,
		),
		/** Transcript entries ordered by seq: one step's, or the whole run's. */
		async transcript(stepId?: string): Promise<TranscriptEntry[]> {
			const rows = await db
				.select({ json: transcript.json })
				.from(transcript)
				.where(stepId ? eq(transcript.stepId, stepId) : undefined)
				.orderBy(asc(transcript.seq));
			return rows.map((row) => JSON.parse(row.json) as TranscriptEntry);
		},
		close: () => db.$client.close(),
	};
}
