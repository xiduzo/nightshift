import { questionKey } from "./questions";

/**
 * How agents use a project's knowledge, from the event log: each search
 * (`KnowledgeSearched`) and each read (`KnowledgeRead`) of an agent. An
 * Agent step logs its own on its step (`StepHandle.usedKnowledge`); the
 * nightshift MCP server's calls are logged with no run (`Knowledge.search`,
 * `Knowledge.read`).
 *
 * The shapes below restate what the log and the read model give (G1):
 * `KnowledgeUseHit` of the agents, `KnowledgeUseFact` of the log and
 * `StepSource` of the read model.
 */

/** One file a search returned, at its best spot. */
type KnowledgeUseHit = {
	path: string;
	section: string | null;
	line: number;
	page: number | null;
	found: ("words" | "meaning")[];
};

/** Where a read started. Absent: the start of the file. */
type KnowledgeReadFrom = { section?: string; line?: number; page?: number };

/** A search or a read, as the log tells it. */
type UsePayload =
	| {
			type: "KnowledgeSearched";
			payload: { query: string; hits: KnowledgeUseHit[] };
	  }
	| {
			type: "KnowledgeRead";
			payload: { path: string; found: boolean; from?: KnowledgeReadFrom };
	  };

/** One knowledge event of a project, newest first: in a run, or through the MCP server. */
export type KnowledgeUseRow = UsePayload & {
	/** Epoch ms. */
	at: number;
	/** Null: through the nightshift MCP server. */
	runId: string | null;
	stepId: string | null;
};

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
export const ASKED_WINDOW = 2_000;

/** How many questions a list holds when the request names no limit. */
export const ASKED_LIMIT = 50;

/**
 * The questions agents asked a project's knowledge, newest first, at most
 * `limit`: each question once (`questionKey`), with what its last asking
 * found, from its latest searches (`rows`, newest first).
 */
export function askedQuestionsOf(
	rows: readonly KnowledgeUseRow[],
	limit: number,
): AskedQuestion[] {
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

/** A file a step's agents used, as the step lists it. */
type StepSource = {
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
export function stepSources(uses: readonly UsePayload[]): StepSource[] {
	/** Where each path was last found, for a read that names no spot. */
	const foundAt = new Map<string, KnowledgeUseHit>();
	const read = new Map<string, StepSource>();
	const found = new Map<string, StepSource>();
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
		// A read from the section a search found is at that hit.
		const atHit =
			!from ||
			(from.section !== undefined &&
				from.section === hit?.section &&
				from.line === undefined);
		read.set(path, {
			path,
			section: atHit
				? (hit?.section ?? from?.section ?? null)
				: (from?.section ?? null),
			page: atHit ? (hit?.page ?? from?.page ?? null) : (from?.page ?? null),
			line: atHit ? (hit?.line ?? 1) : (from?.line ?? 1),
			read: true,
		});
	}
	return [
		...read.values(),
		...[...found.values()].filter((source) => !read.has(source.path)),
	].slice(0, MAX_SOURCES);
}

/** How agents used one file of the knowledge. */
type KnowledgeFileUse = {
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
	/** Only the files agents used. A file no agent ever touched is in `unused`, not here. */
	files: KnowledgeFileUse[];
	/** The paths of the listed files that are not used (`unusedFiles`), in the order listed. */
	unused: string[];
};

const DAY = 24 * 60 * 60 * 1000;
/** How far back the use counts. */
const USE_WINDOW_DAYS = 90;
/** The most events the use reads, newest first. */
export const USE_EVENTS = 20_000;
/** A search counts as finding a file in its top this many. */
const FOUND_IN_TOP = 5;
/** A file no run used for this long is marked: a source may sync it for nothing. */
const UNUSED_DAYS = 30;

/** Where the use counted at `now` starts: 90 days back. */
export function useSince(now: number): number {
	return now - USE_WINDOW_DAYS * DAY;
}

/**
 * Which of the listed files are not used: no run used the file lately, and
 * it has been here long enough to tell. A file that came in yesterday says
 * nothing yet. While no run uses the knowledge at all, no file is marked.
 */
export function unusedFiles(
	use: Pick<KnowledgeUseReport, "unusedDays" | "runsUsedIt" | "files">,
	listed: readonly { path: string; changedAt: number }[],
	now: number,
): string[] {
	if (!use.runsUsedIt) return [];
	const before = now - use.unusedDays * DAY;
	const lastRunAt = new Map(use.files.map((f) => [f.path, f.lastRunAt]));
	return listed
		.filter(
			(file) =>
				file.changedAt < before && (lastRunAt.get(file.path) ?? 0) < before,
		)
		.map((file) => file.path);
}

/**
 * How often agents found and read each file of a project's knowledge in
 * the last 90 days (`rows`, newest first, since `useSince(now)`), in runs
 * and through the MCP server, when a run last used it, and which of the
 * `listed` files are not used (`unusedFiles`).
 */
export function fileUseOf(
	rows: readonly KnowledgeUseRow[],
	listed: readonly { path: string; changedAt: number }[],
	now: number,
): KnowledgeUseReport {
	const since = useSince(now);
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
	const used = {
		since,
		unusedDays: UNUSED_DAYS,
		runsUsedIt,
		files: [...files.values()].sort((a, b) => a.path.localeCompare(b.path)),
	};
	return { ...used, unused: unusedFiles(used, listed, now) };
}
