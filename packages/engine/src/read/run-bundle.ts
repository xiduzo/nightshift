import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createDb, type Database } from "@nightshift/db";
import {
	agentSession,
	clone,
	event,
	project,
	run,
	step,
} from "@nightshift/db/schema";
import { and, asc, eq, sql } from "drizzle-orm";
import {
	integer,
	primaryKey,
	sqliteTable,
	text,
} from "drizzle-orm/sqlite-core";

import {
	type LoggedEvent,
	parseEventRow,
	type TranscriptEntry,
	transcriptToRead,
} from "../log";
import { readFormat1, readFormat2, readRows } from "./bundle-rows";

/**
 * A run bundle is one run in its own small SQLite file: the run, its
 * project and the project's Clones (its folders), its steps, sessions and events, and the lines of
 * its transcripts. The tables keep the names and columns of the daemon's
 * database, so the queries and derivations that read the live log read a
 * bundle too. Nothing from settings, connections or secrets goes in.
 *
 * Call steps belong to the run that calls them (their
 * scope names the calling step), so the run's own rows hold all of it.
 */

/**
 * The format this Night Shift writes. 6: the Devices the run's nodes name.
 * 5: the Device the run's steps run on. 4: the Person who started the run.
 * 3: the Space on every row. 2: the project by its remote, with its
 * Clones; the Walker on runs, steps and events. Format 1 to 3 bundles
 * still open: see `openRunBundle`.
 */
export const RUN_BUNDLE_FORMAT_VERSION = 6;

/** The formats `openRunBundle` reads. */
const READABLE_FORMATS = [1, 2, 3, 4, 5, RUN_BUNDLE_FORMAT_VERSION];

/** What stands in for a secret value that a bundle leaves out. */
const MASK = "•••";

/** One line of a step's transcript file, as written. */
const transcript = sqliteTable(
	"transcript",
	{
		stepId: text("step_id").notNull(),
		/** 1 for the first line of the file. */
		lineNo: integer("line_no").notNull(),
		/** The entry's `seq`: orders lines over all steps of the run. */
		seq: integer("seq").notNull(),
		json: text("json").notNull(),
	},
	(table) => [primaryKey({ columns: [table.stepId, table.lineNo] })],
);

/** Facts about the bundle itself. `value` is JSON-encoded. */
const bundle = sqliteTable("bundle", {
	key: text("key").primaryKey(),
	value: text("value").notNull(),
});

const createdAt =
	"`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL";

/** The live schema's columns, without foreign keys: a bundle is never written again. */
const DDL = [
	"CREATE TABLE `bundle` (`key` text PRIMARY KEY, `value` text NOT NULL)",
	`CREATE TABLE \`project\` (\`id\` text PRIMARY KEY, \`space_id\` text NOT NULL, \`name\` text NOT NULL, \`remote\` text, ${createdAt}, \`removed_at\` integer)`,
	`CREATE TABLE \`clone\` (\`id\` text PRIMARY KEY, \`space_id\` text NOT NULL, \`project_id\` text NOT NULL, \`device_id\` text NOT NULL, \`path\` text NOT NULL, ${createdAt})`,
	`CREATE TABLE \`run\` (\`id\` text PRIMARY KEY, \`space_id\` text NOT NULL, \`project_id\` text NOT NULL, \`flow_name\` text, \`flow\` text NOT NULL, \`body_flows\` text DEFAULT '{}' NOT NULL, \`title\` text NOT NULL, \`worktree_path\` text NOT NULL, \`branch\` text NOT NULL, \`base_ref\` text NOT NULL, \`walker_id\` text NOT NULL, \`device_id\` text, \`placements\` text, \`started_by\` text, ${createdAt})`,
	`CREATE TABLE \`step\` (\`id\` text PRIMARY KEY, \`space_id\` text NOT NULL, \`run_id\` text NOT NULL, \`node_id\` text NOT NULL, \`node_type\` text NOT NULL, \`visit\` integer NOT NULL, \`transcript_path\` text NOT NULL, \`device_id\` text, ${createdAt})`,
	`CREATE TABLE \`agent_session\` (\`id\` text PRIMARY KEY, \`space_id\` text NOT NULL, \`run_id\` text NOT NULL, \`step_id\` text NOT NULL, \`harness_session_id\` text, \`prompt\` text NOT NULL, ${createdAt})`,
	`CREATE TABLE \`event\` (\`seq\` integer PRIMARY KEY, \`space_id\` text NOT NULL, \`run_id\` text, \`step_id\` text, \`session_id\` text, \`type\` text NOT NULL, \`payload\` text DEFAULT '{}' NOT NULL, ${createdAt}, \`walker_id\` text NOT NULL, \`walker_seq\` integer NOT NULL)`,
	"CREATE TABLE `transcript` (`step_id` text NOT NULL, `line_no` integer NOT NULL, `seq` integer NOT NULL, `json` text NOT NULL, PRIMARY KEY (`step_id`, `line_no`))",
];

export type RunBundleMeta = {
	formatVersion: number;
	exportedAt: number;
	runId: string;
	/** The last database migration of the daemon that wrote the bundle. */
	schema: string | null;
	/** Steps whose transcript file was not on disk. */
	missingTranscripts: string[];
	/** How many texts had a secret value taken out. */
	redacted: number;
};

export type RunBundleSummary = {
	path: string;
	runId: string;
	title: string;
	flowName: string | null;
	missingTranscripts: string[];
};

/**
 * Writes the run `runId` of the Space `spaceId` to a new SQLite file at
 * `path`. Every value in `redact` (4 characters or more) becomes `•••` in
 * the copied texts: transcripts, event payloads, prompts, the flow and the
 * title. Returns null when the Space has no such run.
 */
export async function exportRun(options: {
	db: Database;
	/** This computer's data folder, where the steps' transcripts are (`transcriptToRead`). */
	dataDir: string;
	runId: string;
	spaceId: string;
	path: string;
	redact?: readonly string[];
}): Promise<RunBundleSummary | null> {
	const { db, runId, path } = options;
	const [runRow] = await db
		.select()
		.from(run)
		.where(and(eq(run.id, runId), eq(run.spaceId, options.spaceId)));
	if (!runRow) return null;
	if (existsSync(path)) throw new Error(`${path} already exists.`);

	const [projectRow] = await db
		.select()
		.from(project)
		.where(eq(project.id, runRow.projectId));
	const clones = await db
		.select()
		.from(clone)
		.where(eq(clone.projectId, runRow.projectId));
	const steps = await db
		.select()
		.from(step)
		.where(eq(step.runId, runId))
		.orderBy(asc(step.createdAt));
	const sessions = await db
		.select()
		.from(agentSession)
		.where(eq(agentSession.runId, runId))
		.orderBy(asc(agentSession.createdAt));
	const events = await db
		.select()
		.from(event)
		.where(eq(event.runId, runId))
		.orderBy(asc(event.seq));

	const redact = redactor(options.redact ?? []);
	const out = createDb({ DATABASE_URL: `file:${path}` });
	try {
		for (const statement of DDL) await out.run(sql.raw(statement));
		if (projectRow) await out.insert(project).values(projectRow);
		if (clones.length > 0) await out.insert(clone).values(clones);
		await out.insert(run).values({
			...runRow,
			title: redact.text(runRow.title),
			flow: redact.json(runRow.flow),
			bodyFlows: redact.json(runRow.bodyFlows),
		});
		for (const rows of chunks(steps)) await out.insert(step).values(rows);
		for (const rows of chunks(sessions)) {
			await out
				.insert(agentSession)
				.values(rows.map((s) => ({ ...s, prompt: redact.text(s.prompt) })));
		}
		for (const rows of chunks(events)) {
			await out
				.insert(event)
				.values(rows.map((e) => ({ ...e, payload: redact.json(e.payload) })));
		}

		const missing: string[] = [];
		for (const s of steps) {
			const lines = await readTranscriptLines(
				transcriptToRead(options.dataDir, runId, s.id, s.transcriptPath),
			);
			if (!lines) {
				missing.push(s.id);
				continue;
			}
			for (const rows of chunks(lines)) {
				await out.insert(transcript).values(
					rows.map((line) => ({
						stepId: s.id,
						lineNo: line.lineNo,
						seq: line.seq,
						json: redact.json(line.json),
					})),
				);
			}
		}

		const meta: Record<string, unknown> = {
			format_version: RUN_BUNDLE_FORMAT_VERSION,
			exported_at: Date.now(),
			run_id: runId,
			schema: await lastMigration(db),
			missing_transcripts: missing,
			redacted: redact.count(),
		};
		await out.insert(bundle).values(
			Object.entries(meta).map(([key, value]) => ({
				key,
				value: JSON.stringify(value),
			})),
		);
		await out.run(sql.raw("VACUUM"));
		return {
			path,
			runId,
			title: runRow.title,
			flowName: runRow.flowName,
			missingTranscripts: missing,
		};
	} finally {
		out.$client.close();
	}
}

export type RunBundle = {
	meta: RunBundleMeta;
	project: typeof project.$inferSelect | null;
	/** The project's folders, one per Device. */
	clones: (typeof clone.$inferSelect)[];
	run: typeof run.$inferSelect;
	steps: (typeof step.$inferSelect)[];
	sessions: (typeof agentSession.$inferSelect)[];
	/** The run's events, oldest first, ready for `deriveRunState`, `deriveSteps` and the rest. */
	events: LoggedEvent[];
	/** Transcript entries ordered by seq: one step's, or the whole run's. */
	transcript(stepId?: string): Promise<TranscriptEntry[]>;
	close(): void;
};

/** Opens a run bundle to read. It never writes to the file. */
export async function openRunBundle(path: string): Promise<RunBundle> {
	if (!existsSync(path)) throw new Error(`${path} does not exist.`);
	const db = createDb({ DATABASE_URL: `file:${path}` });
	try {
		const tables = await db.all<{ name: string }>(
			sql`select name from sqlite_master where type = 'table' and name = 'bundle'`,
		);
		if (tables.length === 0) {
			throw new Error(`${path} is not a Night Shift run bundle.`);
		}
		const meta = new Map(
			(await db.select().from(bundle)).map((row) => [
				row.key,
				JSON.parse(row.value) as unknown,
			]),
		);
		const formatVersion = Number(meta.get("format_version"));
		if (!READABLE_FORMATS.includes(formatVersion)) {
			throw new Error(
				`${path} is a run bundle of format ${formatVersion}. This Night Shift reads format ${READABLE_FORMATS.join(" and ")}.`,
			);
		}
		const runId = String(meta.get("run_id"));
		const rows =
			formatVersion === 1
				? await readFormat1(db, runId)
				: formatVersion === 2
					? await readFormat2(db, runId)
					: await readRows(db, runId, formatVersion);
		const { run: runRow, project: projectRow, clones, steps, sessions } = rows;
		if (!runRow) throw new Error(`${path} has no run ${runId}.`);
		return {
			meta: {
				formatVersion,
				exportedAt: Number(meta.get("exported_at")),
				runId,
				schema: (meta.get("schema") as string | null) ?? null,
				missingTranscripts: (meta.get("missing_transcripts") as string[]) ?? [],
				redacted: Number(meta.get("redacted") ?? 0),
			},
			project: projectRow ?? null,
			clones,
			run: runRow,
			steps,
			sessions,
			events: rows.events.map(parseEventRow),
			async transcript(stepId) {
				const query = db.select({ json: transcript.json }).from(transcript);
				const rows = await (stepId
					? query.where(eq(transcript.stepId, stepId))
					: query
				).orderBy(asc(transcript.seq));
				return rows.map((row) => JSON.parse(row.json) as TranscriptEntry);
			},
			close: () => db.$client.close(),
		};
	} catch (error) {
		db.$client.close();
		throw error;
	}
}

/** Rows in slices: SQLite takes at most 32766 bound values per statement. */
function* chunks<T>(rows: readonly T[], size = 500): Generator<T[]> {
	for (let i = 0; i < rows.length; i += size) yield rows.slice(i, i + size);
}

/**
 * The parsed lines of a transcript file with their line numbers. Null when
 * the file is missing. A line that does not parse (a torn write) is left out.
 */
async function readTranscriptLines(
	path: string,
): Promise<{ lineNo: number; seq: number; json: string }[] | null> {
	let text: string;
	try {
		text = await readFile(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
	const lines: { lineNo: number; seq: number; json: string }[] = [];
	for (const [index, line] of text.split("\n").entries()) {
		if (!line) continue;
		try {
			const entry = JSON.parse(line) as Partial<TranscriptEntry>;
			if (typeof entry.seq === "number") {
				lines.push({ lineNo: index + 1, seq: entry.seq, json: line });
			}
		} catch {
			// Skip a torn line.
		}
	}
	return lines;
}

async function lastMigration(db: Database): Promise<string | null> {
	try {
		const [row] = await db.all<{ name: string | null }>(
			sql`select name from __drizzle_migrations order by id desc limit 1`,
		);
		return row?.name ?? null;
	} catch {
		return null;
	}
}

/**
 * Takes secret values out of texts. A JSON text is parsed and only its
 * strings change, so the result still parses; the text stays byte for
 * byte the same when no value occurs in it.
 */
function redactor(values: readonly string[]) {
	const secrets = [...new Set(values)]
		.filter((v) => v.length >= 4)
		.sort((a, b) => b.length - a.length);
	// A value inside a JSON string appears escaped.
	const escaped = secrets.map((v) => JSON.stringify(v).slice(1, -1));
	let count = 0;

	const plain = (input: string) =>
		secrets.reduce((t, v) => t.replaceAll(v, MASK), input);
	const walk = (value: unknown): unknown => {
		if (typeof value === "string") return plain(value);
		if (Array.isArray(value)) return value.map(walk);
		if (value && typeof value === "object") {
			return Object.fromEntries(
				Object.entries(value).map(([k, v]) => [plain(k), walk(v)]),
			);
		}
		return value;
	};

	return {
		text(input: string): string {
			if (!secrets.some((v) => input.includes(v))) return input;
			count++;
			return plain(input);
		},
		json(input: string): string {
			if (!escaped.some((v) => input.includes(v))) return input;
			count++;
			try {
				return JSON.stringify(walk(JSON.parse(input)));
			} catch {
				return plain(input);
			}
		},
		count: () => count,
	};
}
