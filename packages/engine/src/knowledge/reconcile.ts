import { randomUUID } from "node:crypto";
import {
	lstat,
	mkdir,
	readdir,
	readFile,
	rename,
	rm,
	rmdir,
	stat,
	writeFile,
} from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import type { Database } from "@nightshift/db";
import { organization, project } from "@nightshift/db/schema";
import { Refusal } from "@nightshift/refusal";
import { eq } from "drizzle-orm";
import type { PersistedDocument } from "../device-config";
import {
	describeText,
	INDEX_FILE,
	type KnowledgeFile,
	type KnowledgeFolders,
	PROPOSED_DIR,
	TEXT_FILES,
} from "./folder";
import {
	isKnowledgePath,
	type KnowledgeDocuments,
	type KnowledgeEntry,
	knowledgeEntries,
	knowledgeFiles,
} from "./knowledge-document";
import type { KnowledgeText } from "./search";
import {
	type KnowledgeStore,
	LOCAL_ONLY_BYTES,
	sha256Of,
	sha256OfFile,
} from "./store";

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
 * into the store and to the Space's Host, then its entry into the
 * document (or out of it). An entry another Device changed is written
 * into the folder: its content comes from the store, else from the Host,
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

/** A Space's Host, as the reconcile copies content to it and fetches it from it. */
export type KnowledgeHost = {
	/**
	 * Keeps content in the archive of the Host that keeps the Space.
	 * Nothing for a Space this Replica keeps. Throws when that Host
	 * cannot be reached or refuses.
	 */
	put(spaceId: string, sha256: string, content: Uint8Array): Promise<void>;
	/**
	 * Content from the archive of the Host that keeps the Space. Null for
	 * a Space this Replica keeps, and when the Host has none. Throws when
	 * that Host cannot be reached.
	 */
	get(spaceId: string, sha256: string): Promise<Uint8Array | null>;
	/**
	 * Resolves when this Replica's copy of a document of the Space and the
	 * Host's are in step, or after a while: `before` a reconcile waits
	 * less than after one. At once for a Space this Replica keeps.
	 */
	settled(
		spaceId: string,
		documentName: string,
		when: "before" | "after",
	): Promise<void>;
};

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
	folders: Pick<KnowledgeFolders, "folder" | "known" | "index">;
	documents: Pick<KnowledgeDocuments, "open">;
	store: KnowledgeStore;
	/** This Device: it signs the entries it writes. */
	deviceId: string;
	/**
	 * The Host of a Space, read at each reconcile: the devices runtime,
	 * made after this. Null or without it: content stays on this Device.
	 */
	host?: () => KnowledgeHost | null;
	/** How long a page read waits for its reconcile. Default 2 s. */
	pageWaitMs?: number;
};

/** The state of the last reconcile, in the folder. Hidden: no walk lists it. */
const STATE_FILE = ".reconciled.json";
/** How many files a reconcile reads, writes or fetches at once. */
const AT_ONCE = 8;

/** An entry as the folder held it at the last reconcile, with the file's time then. */
type Kept = KnowledgeEntry & { mtimeMs: number };
type State = { files: Record<string, Kept>; unpushed: string[] };

/** The reconciles of each folder in this process, one at a time. */
const reconciling = new Map<string, Promise<unknown>>();

/** A project's knowledge, as each Device keeps it in step with the Space. */
export type KnowledgeSync = ReturnType<typeof createKnowledgeSync>;

export function createKnowledgeSync(deps: KnowledgeSyncDeps) {
	const { db, folders, store, deviceId } = deps;
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

	/** Content by hash: this Device's, else the Host's, which it keeps. */
	async function contentOf(
		spaceId: string,
		sha256: string,
		host: KnowledgeHost | null,
	): Promise<Uint8Array | null> {
		const kept = await store.read(spaceId, sha256);
		if (kept || !host) return kept;
		const fetched = await host.get(spaceId, sha256);
		if (!fetched || sha256Of(fetched) !== sha256) return null;
		await store.write(spaceId, sha256, fetched);
		return fetched;
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
		const host = deps.host?.() ?? null;
		await host?.settled(spaceId, document.name, "before").catch(() => {});
		await mkdir(root, { recursive: true });

		const state = await readState(root);
		// A document that never had an update (a new Replica) is not one
		// whose entries were removed: the folder's files are published again.
		const saved = new Map(
			state && hasHistory(document) ? Object.entries(state.files) : [],
		);
		const unpushed = new Set(state?.unpushed ?? []);
		/** The Host failed once: the rest waits for the next reconcile. */
		let offline = host === null;

		async function push(sha256: string, content: Uint8Array) {
			if (!host) return;
			if (offline) {
				unpushed.add(sha256);
				return;
			}
			try {
				await host.put(spaceId, sha256, content);
				unpushed.delete(sha256);
			} catch {
				offline = true;
				unpushed.add(sha256);
			}
		}

		// First what earlier reconciles could not copy to the Host.
		for (const sha256 of [...unpushed]) {
			if (!host || offline) break;
			const content = await store.read(spaceId, sha256);
			if (content) await push(sha256, content);
			else unpushed.delete(sha256);
		}

		async function fetch(sha256: string): Promise<Uint8Array | null> {
			try {
				return await contentOf(spaceId, sha256, offline ? null : host);
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

		/** Publishes the folder's file: content to the store and the Host, then its entry. */
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
				await store.write(spaceId, sha256, content);
				await push(sha256, content);
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
			const written = await writeWhole(abs, content).catch(() => null);
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
			await host?.settled(spaceId, document.name, "after").catch(() => {});
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

	return {
		reconcile,
		/**
		 * The Knowledge page's list: a reconcile first, for a while, so the
		 * document has this Device's own changes, and a fresh index. Then the
		 * document's files and how many notes its proposals hold. The
		 * reconcile goes on when the wait ends.
		 */
		async listing(projectId: string): Promise<KnowledgeListing> {
			const reconciled = reconcile(projectId).catch((error) => {
				console.warn("The knowledge was not brought in step:", error);
			});
			await Promise.race([reconciled, Bun.sleep(deps.pageWaitMs ?? 2_000)]);
			await folders.index(projectId).catch(() => {});
			const spaceId = await spaceOf(projectId);
			const entries = knowledgeEntries(await deps.documents.open(projectId));
			const host = deps.host?.() ?? null;
			const files: KnowledgeFile[] = [];
			let proposed = 0;
			for (const [path, entry] of [...entries].sort(([a], [b]) =>
				a.localeCompare(b),
			)) {
				if (!path.startsWith(`${PROPOSED_DIR}/`)) {
					files.push({
						path,
						size: entry.size,
						changedAt: entry.changedAt,
						...(entry.local ? { local: true as const } : {}),
					});
					continue;
				}
				if (!path.endsWith(".md") || path.split("/").length !== 3) continue;
				const content = spaceId
					? await contentOf(spaceId, entry.sha256, host).catch(() => null)
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
		 * One file of the project's knowledge, by its hash in the document:
		 * for a Device whose folder lacks it. At most `maxBytes` of its text.
		 * Null when the document has no such file. Refuses a file that is
		 * not text, one that stays on another Device, and one whose content
		 * cannot be fetched now.
		 */
		async read(
			projectId: string,
			path: string,
			options: { maxBytes: number },
		): Promise<KnowledgeText | null> {
			const spaceId = await spaceOf(projectId);
			const entry = isKnowledgePath(path)
				? knowledgeEntries(await deps.documents.open(projectId)).get(path)
				: undefined;
			if (spaceId === null || !entry) return null;
			if (entry.local && entry.deviceId !== deviceId) {
				throw new Refusal(
					"unavailable",
					"This file is larger than 10 MB. It stays on the computer that synced it.",
				);
			}
			const content = await contentOf(
				spaceId,
				entry.sha256,
				deps.host?.() ?? null,
			).catch(() => null);
			if (!content) {
				throw new Refusal(
					"unavailable",
					"This file cannot be fetched now. Try again when the computer that keeps this Space is online.",
				);
			}
			const start = content.subarray(0, Math.max(1, options.maxBytes));
			if (start.subarray(0, 8192).includes(0)) {
				throw new Refusal("invalid", `"${path}" is not a text file.`);
			}
			const text = new TextDecoder().decode(start);
			const name = path.split("/").at(-1) ?? path;
			const fallback = name.slice(0, name.length - extname(name).length);
			const title =
				TEXT_FILES.has(extname(name).toLowerCase()) && path !== INDEX_FILE
					? describeText(text.slice(0, 4096), fallback || name).title
					: name;
			return {
				path,
				title,
				text,
				size: content.length,
				truncated: content.length > start.length,
			};
		},
		/**
		 * Reconciles every folder on this computer: the import on upgrade
		 * at the first start, and what waited while the daemon was down.
		 */
		async reconcileAll(): Promise<void> {
			for (const projectId of await folders.known()) {
				await reconcile(projectId).catch((error) => {
					console.warn(
						`The knowledge of ${projectId} was not brought in step:`,
						error,
					);
				});
			}
		},
		/** Reconciles the folders whose content waits for the Host. */
		async retryPending(): Promise<void> {
			for (const projectId of [...pending]) {
				await reconcile(projectId).catch(() => {});
			}
		},
	};
}

/** A file of the folder, as the reconcile compares it. */
type FileStat = { size: number; mtimeMs: number };

/**
 * Every file of the folder that syncs, by path: no hidden file or
 * folder, no link, no index.
 */
async function scan(root: string): Promise<Map<string, FileStat>> {
	const files = new Map<string, FileStat>();
	const visit = async (abs: string, rel: string): Promise<void> => {
		const names = await readdir(abs).catch(() => [] as string[]);
		for (const name of names) {
			if (name.startsWith(".")) continue;
			const path = rel === "" ? name : `${rel}/${name}`;
			const info = await lstat(join(abs, name)).catch(() => null);
			if (!info) continue;
			if (info.isDirectory()) await visit(join(abs, name), path);
			else if (info.isFile() && isKnowledgePath(path)) {
				files.set(path, { size: info.size, mtimeMs: info.mtimeMs });
			}
		}
	};
	await visit(root, "");
	return files;
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
 * Writes a file whole: to a hidden file beside it, then a rename, so a
 * reader never sees half of it. Returns the file as written.
 */
async function writeWhole(
	path: string,
	content: Uint8Array | string,
): Promise<FileStat> {
	const dir = dirname(path);
	await mkdir(dir, { recursive: true });
	const temporary = join(dir, `.knowledge.${randomUUID()}.tmp`);
	try {
		await writeFile(temporary, content);
		await rename(temporary, path);
	} finally {
		await rm(temporary, { force: true });
	}
	const info = await stat(path);
	return { size: info.size, mtimeMs: info.mtimeMs };
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

/** How many notes a proposal holds: one per `- ` line. */
function notesIn(content: Uint8Array): number {
	return new TextDecoder()
		.decode(content)
		.split("\n")
		.filter((line) => line.startsWith("- ")).length;
}
