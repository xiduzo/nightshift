import type { KnowledgeEntry } from "./entry";

/**
 * Knowledge in the Space (ADR 4): each Device's folder is a working copy
 * of the Project's knowledge document. A reconcile brings the two in step
 * before and after each step that gets the folder, and when the
 * Knowledge page reads it. It compares three things per path:
 *
 * - the folder: the file as it is now;
 * - the state of the last reconcile (`.reconciled.json`, hidden in the
 *   folder, so the index and the agents skip it): the entry the folder
 *   held then, with the file's size and modification time. It is the base
 *   of the merge, and the search index never stands in for it;
 * - the document: the entry as the Space has it now.
 *
 * A file the folder changed (its size or time differ, and so does its
 * hash), or a file that came or went, is published: its content goes
 * into the Space archive (here, and at the Space's Host), then its entry
 * into the document (or out of it). An entry another Device changed is
 * written into the folder: its content comes from the archive, here or
 * from the Host, and goes in whole. When both changed one path, the later
 * change wins. A change wins over a removal: nothing is lost.
 *
 * A Device that cannot reach its Host works on its own copy: content it
 * cannot copy to the Host waits in the state (`unpushed`) for the next
 * reconcile, and an entry whose content it cannot fetch keeps the old
 * file until the next one. The step goes on.
 *
 * The first reconcile of a folder (no state yet) is the import on
 * upgrade: it publishes every file, and the later change wins where the
 * document has the path too. `INDEX.md` and hidden files never sync.
 */

/** How long a reconcile waits for the document to be in step with the Host: before it, and after a change. */
export const IN_STEP_BEFORE_MS = 3_000;
export const IN_STEP_AFTER_MS = 10_000;
/** How many files a reconcile reads, writes or fetches at once. */
export const AT_ONCE = 8;

/** One file of the folder as a look found it. */
export type FolderFile = { path: string; size: number; changedAt: number };

/** An entry as the folder held it at the last reconcile, with the file's time then. */
export type Kept = KnowledgeEntry & { mtimeMs: number };

/** The state of the last reconcile: what the folder held, and the content that waits for the Host. */
export type ReconcileState = {
	files: Record<string, Kept>;
	unpushed: string[];
};

/** The state of the last reconcile from its file's text, or null when it has none that reads. */
export function parseReconcileState(
	text: string | null,
): ReconcileState | null {
	if (text === null) return null;
	try {
		const parsed = JSON.parse(text) as Partial<ReconcileState>;
		if (typeof parsed.files !== "object" || parsed.files === null) return null;
		return {
			files: parsed.files,
			unpushed: Array.isArray(parsed.unpushed) ? parsed.unpushed : [],
		};
	} catch {
		return null;
	}
}

/** The text of the state's file. */
export function formatReconcileState(state: ReconcileState): string {
	return JSON.stringify(state);
}

/** What a reconcile leaves behind, for what depends on the document. */
export type KnowledgeReconciled = {
	projectId: string;
	spaceId: string;
	/** What the folder held at the reconcile before this one, by path. */
	held: Readonly<Record<string, { sha256: string }>>;
	/** What the document lists now. */
	listed: ReadonlyMap<string, { sha256: string }>;
};

/** What one reconcile decides, path by path, and does after every path is settled. */
export type ReconcilePlan = {
	/** The state the folder holds after this reconcile, by path. */
	next: Map<string, Kept>;
	/** Entries into the document. */
	sets: [string, KnowledgeEntry][];
	/** Paths out of the document. */
	deletes: string[];
	/** Files to remove from the folder. */
	removals: string[];
	/** Entries whose content to write into the folder. */
	takes: [string, KnowledgeEntry][];
};

export function emptyPlan(): ReconcilePlan {
	return { next: new Map(), sets: [], deletes: [], removals: [], takes: [] };
}

/**
 * Every path a reconcile settles: the folder's, the last state's and the
 * document's, the ones of the knowledge (`counts`) only, sorted.
 */
export function pathsToSettle(
	files: readonly FolderFile[],
	saved: ReadonlyMap<string, Kept>,
	entries: ReadonlyMap<string, KnowledgeEntry>,
	counts: (path: string) => boolean,
): string[] {
	return [
		...new Set([
			...files.map((file) => file.path),
			...saved.keys(),
			...entries.keys(),
		]),
	]
		.filter(counts)
		.sort();
}

/** What `settle` asks of the folder and the archive while it decides one path. */
export type SettleTools = {
	/** The folder's file now, or null. */
	file(path: string): FolderFile | null;
	/** Whether its size or time differ from the last state's. */
	changedHere(path: string): boolean;
	/** The file's hash, read at the first question. Null when it cannot be read. */
	sha256(path: string): Promise<string | null>;
	/**
	 * Publishes the folder's file: content to the archive, then its entry
	 * into `plan.sets`. Its time is later than `after`. Null when it cannot
	 * be read now.
	 */
	publish(path: string, file: FolderFile, after: number): Promise<Kept | null>;
	/** Whether the folders of the path are real folders inside the knowledge folder. */
	inFolder(path: string): Promise<boolean>;
};

/**
 * Settles one path: what the folder, the last state (`was`) and the
 * document (`entry`) say decides whether it is published, removed from
 * the document, removed from the folder, taken from the document, or kept.
 */
export async function settle(
	path: string,
	facts: { was: Kept | null; entry: KnowledgeEntry | null },
	tools: SettleTools,
	plan: ReconcilePlan,
): Promise<void> {
	const { was, entry } = facts;
	const file = tools.file(path);
	const keep = () => {
		if (was) plan.next.set(path, was);
	};

	// Did the folder change it since the last reconcile?
	let localChanged = file !== null || was !== null;
	if (file && was) {
		if (!tools.changedHere(path)) {
			localChanged = false;
		} else {
			const sha256 = await tools.sha256(path);
			if (sha256 === null) return keep();
			localChanged = sha256 !== was.sha256;
		}
	}
	// Did the document change it since?
	const remoteChanged = entry
		? was === null || entry.sha256 !== was.sha256
		: was !== null;
	const after = Math.max(was?.changedAt ?? 0, entry?.changedAt ?? 0);

	if (!localChanged && !remoteChanged) {
		if (file && entry)
			plan.next.set(path, { ...entry, mtimeMs: file.changedAt });
		return;
	}
	if (localChanged && !remoteChanged) {
		if (file) {
			const kept = await tools.publish(path, file, after);
			if (kept) plan.next.set(path, kept);
			else keep();
		} else if (entry) {
			plan.deletes.push(path);
		}
		return;
	}
	if (!localChanged) {
		// Only the document changed it.
		if (!entry) {
			if (file && (await tools.inFolder(path))) plan.removals.push(path);
			return;
		}
		if (was && file && entry.changedAt < was.changedAt) {
			// Two Devices changed it at once, and the document kept the
			// earlier change: the later one, this folder's, goes back.
			const { mtimeMs: _time, ...earlier } = was;
			plan.sets.push([path, earlier]);
			plan.next.set(path, { ...was, mtimeMs: file.changedAt });
			return;
		}
		plan.takes.push([path, entry]);
		return;
	}
	// Both changed it.
	if (file && entry) {
		const sha256 = await tools.sha256(path);
		if (sha256 === null) return keep();
		if (sha256 === entry.sha256) {
			plan.next.set(path, { ...entry, mtimeMs: file.changedAt });
			return;
		}
	}
	const localWins =
		file !== null && (entry === null || file.changedAt > entry.changedAt);
	if (file && localWins) {
		const kept = await tools.publish(path, file, after);
		if (kept) plan.next.set(path, kept);
		else keep();
		return;
	}
	if (entry) plan.takes.push([path, entry]);
}

/**
 * A reconcile whose failure leaves the folder as it is: the step goes on.
 * Its failure is only logged.
 */
export function reconcileQuietly(
	reconcile: (projectId: string) => Promise<void>,
	projectId: string,
): Promise<unknown> {
	return reconcile(projectId).catch((error) => {
		console.warn("The knowledge was not brought in step:", error);
	});
}

/** Runs `each` over the items, at most `limit` at once. */
export async function inTurns<T>(
	items: readonly T[],
	limit: number,
	each: (item: T) => Promise<void>,
): Promise<void> {
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const item = items[next++] as T;
			await each(item);
		}
	};
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, worker),
	);
}
