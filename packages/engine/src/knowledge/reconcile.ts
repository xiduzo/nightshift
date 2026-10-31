import { lstat, mkdir, readFile, rm, rmdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Database } from "@nightshift/db";
import { organization, project } from "@nightshift/db/schema";
import { Refusal } from "@nightshift/refusal";
import { eq } from "drizzle-orm";
import {
	type SpaceArchive,
	sha256Of,
	sha256OfFile,
	writeWhole,
} from "../archive";
import type { PersistedDocument } from "../documents";
import { LOCAL_ONLY_BYTES } from "./documents";
import {
	isKnowledgePath,
	isReadable,
	type KnowledgeFile,
	type KnowledgeFolders,
	type KnowledgeText,
	knowledgeText,
	walkFolder,
} from "./folder";
import {
	type KnowledgeDocuments,
	type KnowledgeEntry,
	knowledgeEntries,
	knowledgeFiles,
} from "./knowledge-document";
import {
	isLearningsFolder,
	isProposal,
	isProposalFile,
	notesIn,
} from "./learnings";

/**
 * Knowledge in the Space (ADR 4): each Device's folder is a working copy
 * of the Project's knowledge document. `reconcile` brings the two in step
 * before and after each step that gets the folder, and when the
 * Knowledge page reads it. It compares three things per path:
 *
 * - the folder: the file as it is now;
 * - the state of the last reconcile (`.reconciled.json`, hidden in the
 *   folder, so the index and the agents skip it): the entry the folder
 *   held then, with the file's size and modification time;
 * - the document: the entry as the Space has it now.
 *
 * A file the folder changed (its size or time differ, and so does its
 * hash), or a file that came or went, is published: its content goes
 * into the Space archive (here, and at the Space's Host), then its entry
 * into the document (or out of it). An entry another Device changed is
 * written into the folder: its content comes from the archive, here or
 * from the Host,
 * and goes in whole. When both changed one path, the later change wins.
 * A change wins over a removal: nothing is lost.
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

/** What one reconcile did. */
export type ReconcileResult = {
	/** Entries this Device wrote into the document. */
	published: number;
	/** Entries it removed from the document. */
	unpublished: number;
	/** Files it wrote into the folder from the document. */
	written: number;
	/** Files it removed from the folder. */
	removed: number;
	/** Entries whose content it could not fetch now: their files wait. */
	waiting: number;
	/** Content the Host does not have yet. */
	unpushed: number;
};

/** What the Knowledge page lists: the document's files, and the learnings that wait. */
export type KnowledgeListing = {
	/** The files, the proposals left out, by path. */
	files: KnowledgeFile[];
	/** How many notes the proposals hold. */
	proposed: number;
	/** The Project's Space is not a personal one: each of its Members reads the knowledge. */
	shared: boolean;
};

export type KnowledgeSyncDeps = {
	db: Database;
	folders: Pick<KnowledgeFolders, "folder" | "known" | "read">;
	documents: Pick<KnowledgeDocuments, "open">;
	/** The content by hash: here, and at the Space's Host. */
	archive: Pick<SpaceArchive, "here" | "read" | "put">;
	/** This Device: it signs the entries it writes. */
	deviceId: string;
	/**
	 * Waits until this Replica's copies of documents of a Space and its
	 * Host's are in step, for `timeoutMs` at most. At once for a Space this
	 * Replica keeps, and while its Host cannot be reached. Without it: no wait.
	 */
	inStep?(
		spaceId: string,
		names: readonly string[],
		options: { timeoutMs: number },
	): Promise<unknown>;
	/** How long a page read waits for its reconcile. Default 2 s. */
	pageWaitMs?: number;
};

/** The state of the last reconcile, in the folder. Hidden: no walk lists it. */
const STATE_FILE = ".reconciled.json";
/** How long a reconcile waits for the document to be in step with the Host: before it, and after a change. */
const IN_STEP_BEFORE_MS = 3_000;
const IN_STEP_AFTER_MS = 10_000;
/** How many files a reconcile reads, writes or fetches at once. */
const AT_ONCE = 8;

/** An entry as the folder held it at the last reconcile, with the file's time then. */
type Kept = KnowledgeEntry & { mtimeMs: number };
type State = { files: Record<string, Kept>; unpushed: string[] };

/** The reconciles of each folder in this process, one at a time. */
const reconciling = new Map<string, Promise<unknown>>();
/**
 * How many steps write each folder now, in this process. While one does,
 * only the steps reconcile it: a scan in the middle of a sync would
 * publish half of what it writes.
 */
const writing = new Map<string, number>();

/** A step's hold on a project's folder: `done` when the step ends. */
export type KnowledgeStepHold = { done(): Promise<void> };

/** A project's knowledge, as each Device keeps it in step with the Space. */
export type KnowledgeSync = ReturnType<typeof createKnowledgeSync>;

export function createKnowledgeSync(deps: KnowledgeSyncDeps) {
	const { db, folders, archive, deviceId } = deps;
	/** The projects whose content waits for the Host. */
	const pending = new Set<string>();

	async function spaceOf(projectId: string): Promise<string | null> {
		const [row] = await db
			.select({ spaceId: project.spaceId })
			.from(project)
			.where(eq(project.id, projectId));
		return row?.spaceId ?? null;
	}

	/** Whether a Space has Members besides one Person: it is not a personal Space. */
	async function isShared(spaceId: string): Promise<boolean> {
		const [row] = await db
			.select({ personal: organization.personal })
			.from(organization)
			.where(eq(organization.id, spaceId));
		return row ? !row.personal : false;
	}

	async function reconcileOnce(projectId: string): Promise<ReconcileResult> {
		const result: ReconcileResult = {
			published: 0,
			unpublished: 0,
			written: 0,
			removed: 0,
			waiting: 0,
			unpushed: 0,
		};
		const space = await spaceOf(projectId);
		if (space === null) return result;
		const spaceId: string = space;
		const root = folders.folder(projectId);
		const document = await deps.documents.open(projectId);
		// The Host's changes first, a short while: the step must not wait long.
		await deps
			.inStep?.(spaceId, [document.name], { timeoutMs: IN_STEP_BEFORE_MS })
			.catch(() => {});
		await mkdir(root, { recursive: true });

		const state = await readState(root);
		// A document that never had an update (a new Replica) is not one
		// whose entries were removed: the folder's files are published again.
		const saved = new Map(
			state && hasHistory(document) ? Object.entries(state.files) : [],
		);
		const unpushed = new Set(state?.unpushed ?? []);
		/** The Host failed once: the rest waits for the next reconcile. */
		let offline = false;
		const ref = (sha256: string) => ({
			kind: "content" as const,
			spaceId,
			sha256,
		});

		/** Keeps content in the archive: here, and at the Host while it answers. */
		async function keep(sha256: string, content: Uint8Array) {
			if (!offline) {
				try {
					await archive.put({ ref: ref(sha256), content });
					unpushed.delete(sha256);
					return;
				} catch {
					offline = true;
				}
			}
			await archive.here.write({ ref: ref(sha256), content });
			unpushed.add(sha256);
		}

		// First what earlier reconciles could not copy to the Host.
		for (const sha256 of [...unpushed]) {
			if (offline) break;
			const content = await archive.here.read(ref(sha256));
			if (content) await keep(sha256, content);
			else unpushed.delete(sha256);
		}

		/** Content by hash: here, else from the Host while it answers. */
		async function fetch(sha256: string): Promise<Uint8Array | null> {
			if (offline) return archive.here.read(ref(sha256));
			try {
				return await archive.read(ref(sha256));
			} catch {
				offline = true;
				return null;
			}
		}

		const files = await scan(root);
		const entries = knowledgeEntries(document);
		const next = new Map<string, Kept>();
		const sets: [string, KnowledgeEntry][] = [];
		const deletes: string[] = [];

		/** Publishes the folder's file: content to the archive, then its entry. */
		async function publish(
			path: string,
			file: FileStat,
			known: string | null,
			after: number,
		): Promise<Kept | null> {
			const abs = join(root, ...path.split("/"));
			const changedAt = Math.max(file.mtimeMs, after + 1);
			let entry: KnowledgeEntry;
			if (file.size > LOCAL_ONLY_BYTES) {
				const sha256 = known ?? (await sha256OfFile(abs).catch(() => null));
				if (sha256 === null) return null;
				entry = { sha256, size: file.size, changedAt, deviceId, local: true };
			} else {
				const content = await readFile(abs)
					.then((buffer) => new Uint8Array(buffer))
					.catch(() => null);
				if (content === null) return null;
				const sha256 = sha256Of(content);
				await keep(sha256, content);
				entry = { sha256, size: content.length, changedAt, deviceId };
			}
			sets.push([path, entry]);
			result.published++;
			return { ...entry, mtimeMs: file.mtimeMs };
		}

		/** Writes the entry's content into the folder. Null when it cannot now. */
		async function take(path: string, entry: KnowledgeEntry) {
			// A large file stays on the Device that has it.
			if (entry.local) return null;
			if (!(await inFolder(root, path))) return null;
			const content = await fetch(entry.sha256);
			if (!content) return null;
			const abs = join(root, ...path.split("/"));
			const written = await writeWhole(abs, content)
				.then(() => stat(abs))
				.catch(() => null);
			if (!written) return null;
			result.written++;
			return { ...entry, size: written.size, mtimeMs: written.mtimeMs };
		}

		async function settle(path: string): Promise<void> {
			const file = files.get(path) ?? null;
			const was = saved.get(path) ?? null;
			const entry = entries.get(path) ?? null;
			const keep = () => {
				if (was) next.set(path, was);
			};

			// Did the folder change it since the last reconcile?
			let sha256: string | null = null;
			let localChanged = file !== null || was !== null;
			if (file && was) {
				if (file.size === was.size && file.mtimeMs === was.mtimeMs) {
					localChanged = false;
				} else {
					sha256 = await sha256OfFile(join(root, ...path.split("/"))).catch(
						() => null,
					);
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
				if (file && entry) next.set(path, { ...entry, mtimeMs: file.mtimeMs });
				return;
			}
			if (localChanged && !remoteChanged) {
				if (file) {
					const kept = await publish(path, file, sha256, after);
					if (kept) next.set(path, kept);
					else keep();
				} else if (entry) {
					deletes.push(path);
					result.unpublished++;
				}
				return;
			}
			if (!localChanged) {
				// Only the document changed it.
				if (!entry) {
					if (file && (await inFolder(root, path))) {
						await removeFile(root, path);
					}
					result.removed++;
					return;
				}
				if (was && file && entry.changedAt < was.changedAt) {
					// Two Devices changed it at once, and the document kept the
					// earlier change: the later one, this folder's, goes back.
					const { mtimeMs: _time, ...earlier } = was;
					sets.push([path, earlier]);
					result.published++;
					next.set(path, { ...was, mtimeMs: file.mtimeMs });
					return;
				}
				const taken = await take(path, entry);
				if (taken) next.set(path, taken);
				else {
					result.waiting++;
					keep();
				}
				return;
			}
			// Both changed it.
			if (file && entry) {
				sha256 ??= await sha256OfFile(join(root, ...path.split("/"))).catch(
					() => null,
				);
				if (sha256 === null) return keep();
				if (sha256 === entry.sha256) {
					next.set(path, { ...entry, mtimeMs: file.mtimeMs });
					return;
				}
			}
			const localWins =
				file !== null && (entry === null || file.mtimeMs > entry.changedAt);
			if (file && localWins) {
				const kept = await publish(path, file, sha256, after);
				if (kept) next.set(path, kept);
				else keep();
				return;
			}
			if (entry) {
				const taken = await take(path, entry);
				if (taken) next.set(path, taken);
				else {
					result.waiting++;
					keep();
				}
			}
		}

		const paths = [
			...new Set([...files.keys(), ...saved.keys(), ...entries.keys()]),
		]
			.filter(isKnowledgePath)
			.sort();
		await inTurns(paths, AT_ONCE, settle);

		if (sets.length > 0 || deletes.length > 0) {
			const map = knowledgeFiles(document);
			await document.change(() => {
				for (const path of deletes) map.delete(path);
				for (const [path, entry] of sets) map.set(path, entry);
			});
		}
		result.unpushed = unpushed.size;
		await writeState(root, {
			files: Object.fromEntries(next),
			unpushed: [...unpushed],
		});
		if (unpushed.size > 0) pending.add(projectId);
		else pending.delete(projectId);
		if (sets.length > 0 || deletes.length > 0) {
			// This Device's changes reach the Host before the step ends: the
			// next step on another Device reads them.
			await deps
				.inStep?.(spaceId, [document.name], { timeoutMs: IN_STEP_AFTER_MS })
				.catch(() => {});
		}
		return result;
	}

	/** One reconcile of a folder at a time, in this process. */
	function reconcile(projectId: string): Promise<ReconcileResult> {
		const root = folders.folder(projectId);
		const before = reconciling.get(root) ?? Promise.resolve();
		const run = before.catch(() => {}).then(() => reconcileOnce(projectId));
		reconciling.set(root, run);
		const forget = () => {
			if (reconciling.get(root) === run) reconciling.delete(root);
		};
		run.then(forget, forget);
		return run;
	}

	/** Whether a step writes the project's folder now. */
	function busy(projectId: string): boolean {
		return (writing.get(folders.folder(projectId)) ?? 0) > 0;
	}

	/** A reconcile whose failure leaves the folder as it is: the step goes on. */
	function reconcileQuietly(projectId: string): Promise<unknown> {
		return reconcile(projectId).catch((error) => {
			console.warn("The knowledge was not brought in step:", error);
		});
	}

	return {
		reconcile,
		/**
		 * A step that gets the project's folder starts: the folder is brought
		 * in step with the Space first, and nothing else reconciles it until
		 * `done`. Then the reconcile publishes what the step wrote. Steps that
		 * share the folder share the hold: the first reconciles before, the
		 * last after. A reconcile that fails leaves the folder as it is.
		 */
		async startStep(projectId: string): Promise<KnowledgeStepHold> {
			const root = folders.folder(projectId);
			const held = writing.get(root) ?? 0;
			writing.set(root, held + 1);
			// A step that shares the folder waits for the first one's reconcile.
			if (held === 0) await reconcileQuietly(projectId);
			else await reconciling.get(root)?.catch(() => {});
			let released = false;
			return {
				async done() {
					if (released) return;
					released = true;
					const left = (writing.get(root) ?? 1) - 1;
					if (left > 0) {
						writing.set(root, left);
						return;
					}
					writing.delete(root);
					await reconcileQuietly(projectId);
				},
			};
		},
		/**
		 * The Knowledge page's list: a reconcile first, for a while, so the
		 * document has this Device's own changes. Then the document's files
		 * and how many notes its proposals hold. The reconcile goes on when
		 * the wait ends. While a step writes the folder, the page lists the
		 * document as it is.
		 */
		async listing(projectId: string): Promise<KnowledgeListing> {
			const reconciled = busy(projectId)
				? Promise.resolve()
				: reconcileQuietly(projectId);
			await Promise.race([reconciled, Bun.sleep(deps.pageWaitMs ?? 2_000)]);
			const spaceId = await spaceOf(projectId);
			const entries = knowledgeEntries(await deps.documents.open(projectId));
			const files: KnowledgeFile[] = [];
			let proposed = 0;
			for (const [path, entry] of [...entries].sort(([a], [b]) =>
				a.localeCompare(b),
			)) {
				if (!isProposal(path)) {
					files.push({
						path,
						size: entry.size,
						changedAt: entry.changedAt,
						...(entry.local ? { local: true as const } : {}),
					});
					continue;
				}
				if (!isProposalFile(path)) continue;
				const content = spaceId
					? await archive
							.read({ kind: "content", spaceId, sha256: entry.sha256 })
							.catch(() => null)
					: null;
				// A proposal whose content is not here holds one note at least.
				proposed += content ? notesIn(content) : 1;
			}
			return {
				files,
				proposed,
				shared: spaceId ? await isShared(spaceId) : false,
			};
		},
		/**
		 * One file of the project's knowledge, by its path, at most
		 * `maxBytes` of its text: this Device's copy, else its content by
		 * its hash in the document, from the archive here or at the Host. A PDF or
		 * Word file gives its text either way. Null when neither has the
		 * file, and for a proposal. Refuses (never a plain error) a file
		 * that is not text, one that stays on another Device, and one whose
		 * content cannot be fetched now.
		 */
		async read(
			projectId: string,
			path: string,
			maxBytes: number,
		): Promise<KnowledgeText | null> {
			// This computer's folder first: it may not have the file yet.
			const here = await folders.read(projectId, path, maxBytes);
			if (here) return here;
			const clean = path.trim().replace(/^\.\/+/, "");
			const spaceId = await spaceOf(projectId);
			const entry = isReadable(clean)
				? knowledgeEntries(await deps.documents.open(projectId)).get(clean)
				: undefined;
			if (spaceId === null || !entry) return null;
			if (entry.local && entry.deviceId !== deviceId) {
				throw new Refusal(
					"unavailable",
					"This file is larger than 10 MB. It stays on the computer that synced it.",
				);
			}
			const content = await archive
				.read({ kind: "content", spaceId, sha256: entry.sha256 })
				.catch(() => null);
			if (!content) {
				throw new Refusal(
					"unavailable",
					"Night Shift cannot get this file now. Try again when the computer that keeps this Space is online.",
				);
			}
			return knowledgeText(clean, content, maxBytes);
		},
		/**
		 * Removes a folder of the project's knowledge, for every Device of
		 * the Space: its entries leave the document (after a reconcile, so
		 * this Device's own changes are in it first), and the next reconcile
		 * of each Device removes the files from its folder. Removes the
		 * folder's files here at once. Returns how many files it removed.
		 */
		async removeFolder(projectId: string, folder: string): Promise<number> {
			const name = folder.replace(/\/+$/, "");
			const prefix = `${name}/`;
			if (!isKnowledgePath(`${prefix}x`) || isLearningsFolder(name)) {
				throw new Refusal(
					"invalid",
					"Choose a folder inside the knowledge. learnings is Night Shift's own.",
				);
			}
			if (busy(projectId)) {
				throw new Refusal(
					"conflict",
					"A run is changing this knowledge now. Try again when it ends.",
				);
			}
			await reconcile(projectId);
			const document = await deps.documents.open(projectId);
			const paths = [...knowledgeEntries(document).keys()].filter((path) =>
				path.startsWith(prefix),
			);
			if (paths.length > 0) {
				const map = knowledgeFiles(document);
				await document.change(() => {
					for (const path of paths) map.delete(path);
				});
			}
			await reconcile(projectId);
			return paths.length;
		},
		/**
		 * Reconciles every folder on this computer: the import on upgrade
		 * at the first start, and what waited while the daemon was down.
		 */
		async reconcileAll(): Promise<void> {
			for (const projectId of await folders.known()) {
				// A step's own reconcile publishes what it writes.
				if (busy(projectId)) continue;
				await reconcile(projectId).catch((error) => {
					console.warn(
						`The knowledge of ${projectId} was not brought in step:`,
						error,
					);
				});
			}
		},
		/**
		 * Reconciles the folders whose content waits for the Host, but not
		 * one a step writes now.
		 */
		async retryPending(): Promise<void> {
			for (const projectId of [...pending]) {
				if (busy(projectId)) continue;
				await reconcile(projectId).catch(() => {});
			}
		},
	};
}

/** A file of the folder, as the reconcile compares it. */
type FileStat = { size: number; mtimeMs: number };

/** Every file of the folder that syncs (`isKnowledgePath`), by path. */
async function scan(root: string): Promise<Map<string, FileStat>> {
	const { files } = await walkFolder(root);
	return new Map(
		files.map((file) => [
			file.path,
			{ size: file.size, mtimeMs: file.changedAt },
		]),
	);
}

/** Whether a document ever had an update: an empty one may only be new. */
function hasHistory(document: PersistedDocument): boolean {
	return document.doc.store.clients.size > 0;
}

async function readState(root: string): Promise<State | null> {
	const text = await readFile(join(root, STATE_FILE), "utf8").catch(() => null);
	if (text === null) return null;
	try {
		const parsed = JSON.parse(text) as Partial<State>;
		if (typeof parsed.files !== "object" || parsed.files === null) return null;
		return {
			files: parsed.files,
			unpushed: Array.isArray(parsed.unpushed) ? parsed.unpushed : [],
		};
	} catch {
		return null;
	}
}

async function writeState(root: string, state: State): Promise<void> {
	await writeWhole(join(root, STATE_FILE), JSON.stringify(state));
}

/**
 * Whether the folders of a path are real folders inside the knowledge
 * folder: a link among them could lead a write or a removal out of it.
 */
async function inFolder(root: string, path: string): Promise<boolean> {
	const parts = path.split("/");
	for (let depth = 1; depth < parts.length; depth++) {
		const info = await lstat(join(root, ...parts.slice(0, depth))).catch(
			() => null,
		);
		if (info === null) return true;
		if (!info.isDirectory()) return false;
	}
	return true;
}

/** Removes a file and the folders it leaves empty, up to the knowledge folder. */
async function removeFile(root: string, path: string): Promise<void> {
	const parts = path.split("/");
	await rm(join(root, ...parts), { force: true });
	for (let depth = parts.length - 1; depth > 0; depth--) {
		const removed = await rmdir(join(root, ...parts.slice(0, depth)))
			.then(() => true)
			.catch(() => false);
		if (!removed) return;
	}
}

/** Runs `each` over the items, at most `limit` at once. */
async function inTurns<T>(
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
