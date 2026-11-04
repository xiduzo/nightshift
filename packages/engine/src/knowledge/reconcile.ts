import {
	lstat,
	mkdir,
	readFile,
	rename,
	rm,
	rmdir,
	stat,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import {
	isKnowledgeOwnFolder,
	KNOWLEDGE_OWN_FOLDERS_WORDS,
	KNOWLEDGE_RECONCILE_FILE,
} from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import { type SpaceArchive, sha256Of, writeWhole } from "../archive";
import { LOCAL_ONLY_BYTES } from "./documents";
import type { KnowledgeFolders } from "./folder";
import type { KnowledgeFolderLocks } from "./folder-locks";
import {
	isKnowledgePath,
	type KnowledgeFile,
	scanFolder,
} from "./folder-snapshot";
import type { KnowledgeDocuments, KnowledgeEntry } from "./knowledge-document";
import type { SpaceHostStatus } from "./space-host-status";

/**
 * Knowledge in the Space (ADR 4): each Device's folder is a working copy
 * of the Project's knowledge document. `reconcile` brings the two in step
 * before and after each step that gets the folder, and when the
 * Knowledge page reads it. It compares three things per path:
 *
 * - the folder: the file as it is now;
 * - the state of the last reconcile (`.reconciled.json`, hidden in the
 *   folder, so the index and the agents skip it): the entry the folder
 *   held then, with the file's size and modification time. It is the base
 *   of the merge, and the search index never stands in for it
 *   (`folder-snapshot.ts`);
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

export type KnowledgeSyncDeps = {
	folders: Pick<KnowledgeFolders, "folder" | "known" | "scan">;
	documents: Pick<KnowledgeDocuments, "open" | "remove">;
	/** The content by hash: here, and at the Space's Host. */
	archive: Pick<SpaceArchive, "here" | "read" | "put">;
	/** Which Space a Project has, and whether its Host takes this knowledge now. */
	status: SpaceHostStatus;
	/** The turns and the holds of each folder in this process. */
	locks: KnowledgeFolderLocks;
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
	/** A reconcile brought the folder and the document in step. It must not fail. */
	reconciled?(change: KnowledgeReconciled): Promise<void>;
};

/** How long a reconcile waits for the document to be in step with the Host: before it, and after a change. */
const IN_STEP_BEFORE_MS = 3_000;
const IN_STEP_AFTER_MS = 10_000;
/** How many files a reconcile reads, writes or fetches at once. */
const AT_ONCE = 8;

/** An entry as the folder held it at the last reconcile, with the file's time then. */
type Kept = KnowledgeEntry & { mtimeMs: number };
type State = { files: Record<string, Kept>; unpushed: string[] };

/** A Project of a Space move: its Space and id before, and after (`ProjectsMoved` of the run). */
export type MovedProject = {
	from: { spaceId: string; projectId: string };
	to: { spaceId: string; projectId: string };
};

/** What a reconcile leaves behind, for what depends on the document. */
export type KnowledgeReconciled = {
	projectId: string;
	spaceId: string;
	/** What the folder held at the reconcile before this one, by path. */
	held: Readonly<Record<string, { sha256: string }>>;
	/** What the document lists now. */
	listed: ReadonlyMap<string, { sha256: string }>;
};

/** A step's hold on a project's folder: `done` when the step ends. */
export type KnowledgeStepHold = { done(): Promise<void> };

/** A project's knowledge, as each Device keeps it in step with the Space. */
export type KnowledgeSync = ReturnType<typeof createKnowledgeSync>;

export function createKnowledgeSync(deps: KnowledgeSyncDeps) {
	const { folders, archive, status, locks, deviceId } = deps;
	/** The projects whose content waits for the Host. */
	const pending = new Set<string>();

	async function reconcileOnce(projectId: string): Promise<void> {
		const space = await status.spaceOf(projectId);
		if (space === null) return;
		const spaceId: string = space;
		const root = folders.folder(projectId);
		const document = await deps.documents.open(projectId);
		// A Host of an older version takes no knowledge: no wait, no call.
		const older = status.isOlder(spaceId);
		// The Host's changes first, a short while: the step must not wait long.
		if (!older) {
			await deps
				.inStep?.(spaceId, [document.name], { timeoutMs: IN_STEP_BEFORE_MS })
				.catch(() => {});
		}
		await mkdir(root, { recursive: true });

		const state = await readState(root);
		// A document that never had an update (a new Replica) is not one
		// whose entries were removed: the folder's files are published again.
		const saved = new Map(
			state && !document.isNew() ? Object.entries(state.files) : [],
		);
		const unpushed = new Set(state?.unpushed ?? []);
		/** The Host failed once: the rest waits for the next reconcile. */
		let offline = older;
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
					status.answered(spaceId);
					return;
				} catch (error) {
					status.heard(spaceId, error);
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
			} catch (error) {
				status.heard(spaceId, error);
				offline = true;
				return null;
			}
		}

		const snapshot = await folders.scan(projectId);
		const local = snapshot.changedSince(saved);
		const entries = document.entries();
		const next = new Map<string, Kept>();
		const sets: [string, KnowledgeEntry][] = [];
		const deletes: string[] = [];

		/** Publishes the folder's file: content to the archive, then its entry. */
		async function publish(
			path: string,
			file: KnowledgeFile,
			after: number,
		): Promise<Kept | null> {
			const abs = join(root, ...path.split("/"));
			const changedAt = Math.max(file.changedAt, after + 1);
			let entry: KnowledgeEntry;
			if (file.size > LOCAL_ONLY_BYTES) {
				const sha256 = await snapshot.sha256(path);
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
			return { ...entry, mtimeMs: file.changedAt };
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
			return { ...entry, size: written.size, mtimeMs: written.mtimeMs };
		}

		async function settle(path: string): Promise<void> {
			const file = snapshot.file(path) ?? null;
			const was = saved.get(path) ?? null;
			const entry = entries.get(path) ?? null;
			const keep = () => {
				if (was) next.set(path, was);
			};

			// Did the folder change it since the last reconcile?
			let localChanged = file !== null || was !== null;
			if (file && was) {
				if (!local.changed.has(path)) {
					localChanged = false;
				} else {
					const sha256 = await snapshot.sha256(path);
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
					next.set(path, { ...entry, mtimeMs: file.changedAt });
				return;
			}
			if (localChanged && !remoteChanged) {
				if (file) {
					const kept = await publish(path, file, after);
					if (kept) next.set(path, kept);
					else keep();
				} else if (entry) {
					deletes.push(path);
				}
				return;
			}
			if (!localChanged) {
				// Only the document changed it.
				if (!entry) {
					if (file && (await inFolder(root, path))) {
						await removeFile(root, path);
					}
					return;
				}
				if (was && file && entry.changedAt < was.changedAt) {
					// Two Devices changed it at once, and the document kept the
					// earlier change: the later one, this folder's, goes back.
					const { mtimeMs: _time, ...earlier } = was;
					sets.push([path, earlier]);
					next.set(path, { ...was, mtimeMs: file.changedAt });
					return;
				}
				const taken = await take(path, entry);
				if (taken) next.set(path, taken);
				else keep();
				return;
			}
			// Both changed it.
			if (file && entry) {
				const sha256 = await snapshot.sha256(path);
				if (sha256 === null) return keep();
				if (sha256 === entry.sha256) {
					next.set(path, { ...entry, mtimeMs: file.changedAt });
					return;
				}
			}
			const localWins =
				file !== null && (entry === null || file.changedAt > entry.changedAt);
			if (file && localWins) {
				const kept = await publish(path, file, after);
				if (kept) next.set(path, kept);
				else keep();
				return;
			}
			if (entry) {
				const taken = await take(path, entry);
				if (taken) next.set(path, taken);
				else keep();
			}
		}

		const paths = [
			...new Set([
				...snapshot.files.map((file) => file.path),
				...saved.keys(),
				...entries.keys(),
			]),
		]
			.filter(isKnowledgePath)
			.sort();
		await inTurns(paths, AT_ONCE, settle);

		await document.apply({ delete: deletes, set: sets });
		await writeState(root, {
			files: Object.fromEntries(next),
			unpushed: [...unpushed],
		});
		if (unpushed.size > 0) pending.add(projectId);
		else pending.delete(projectId);
		await deps.reconciled?.({
			projectId,
			spaceId,
			held: state?.files ?? {},
			listed: document.entries(),
		});
		if ((sets.length > 0 || deletes.length > 0) && !status.isOlder(spaceId)) {
			// This Device's changes reach the Host before the step ends: the
			// next step on another Device reads them.
			await deps
				.inStep?.(spaceId, [document.name], { timeoutMs: IN_STEP_AFTER_MS })
				.catch(() => {});
		}
	}

	/** One reconcile of a folder at a time, in this process. */
	function reconcile(projectId: string): Promise<void> {
		return locks.inTurn(folders.folder(projectId), () =>
			reconcileOnce(projectId),
		);
	}

	/**
	 * A Project moved to another Space, and maybe to another id there (a
	 * Device that joins a Space whose Project has its remote). Its content
	 * goes into the new Space's archive here, and waits there for the new
	 * Space's Host as unpushed content. With a new id, its folder becomes
	 * the new id's folder (a file the new folder has already stays when it
	 * is newer), its old document goes, and the next reconcile is an import:
	 * it publishes every file into the new id's document, and the later
	 * change wins. Nothing happens for a Project with no knowledge here.
	 */
	async function moveOnce({ from, to }: MovedProject): Promise<void> {
		const fromRoot = folders.folder(from.projectId);
		const toRoot = folders.folder(to.projectId);
		const renamed = from.projectId !== to.projectId;
		const state = await readState(fromRoot);
		const document = await deps.documents.open(from.projectId);
		const unpushed = new Set(state?.unpushed ?? []);
		for (const entry of document.entries().values()) {
			if (!entry.local) unpushed.add(entry.sha256);
		}
		if (from.spaceId !== to.spaceId) {
			for (const sha256 of [...unpushed]) {
				const content = await archive.here
					.read({ kind: "content", spaceId: from.spaceId, sha256 })
					.catch(() => null);
				if (!content) {
					// Not here: the Host of the old Space has it, or nobody does.
					unpushed.delete(sha256);
					continue;
				}
				await archive.here.write({
					ref: { kind: "content", spaceId: to.spaceId, sha256 },
					content,
				});
			}
		}
		const hasFolder = (await stat(fromRoot).catch(() => null)) !== null;
		if (!renamed) {
			if (!hasFolder && unpushed.size === 0) return;
			await writeState(toRoot, {
				files: state?.files ?? {},
				unpushed: [...unpushed],
			});
			pending.add(to.projectId);
			return;
		}
		if (hasFolder) await moveFolder(fromRoot, toRoot);
		await deps.documents.remove(from.projectId);
		if (!hasFolder && unpushed.size === 0) return;
		// The state of the new folder knows none of its files: an import.
		const before = await readState(toRoot);
		await writeState(toRoot, {
			files: {},
			unpushed: [...new Set([...(before?.unpushed ?? []), ...unpushed])],
		});
		pending.add(to.projectId);
	}

	/** Whether a step writes the project's folder now. */
	function busy(projectId: string): boolean {
		return locks.held(folders.folder(projectId));
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
			// A step that shares the folder waits for the first one's reconcile.
			if (locks.hold(root)) await reconcileQuietly(projectId);
			else await locks.turnsEnded(root);
			let released = false;
			return {
				async done() {
					if (released) return;
					released = true;
					if (locks.release(root)) await reconcileQuietly(projectId);
				},
			};
		},
		/** A reconcile that leaves the folder as it is when it fails. None while a step writes the folder. */
		reconcileUnlessHeld(projectId: string): Promise<unknown> {
			return busy(projectId) ? Promise.resolve() : reconcileQuietly(projectId);
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
			if (!isKnowledgePath(`${prefix}x`) || isKnowledgeOwnFolder(name)) {
				throw new Refusal(
					"invalid",
					`Choose a folder inside the knowledge. ${KNOWLEDGE_OWN_FOLDERS_WORDS}`,
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
			const paths = [...document.entries().keys()].filter((path) =>
				path.startsWith(prefix),
			);
			await document.apply({ delete: paths });
			await reconcile(projectId);
			return paths.length;
		},
		/**
		 * Moves a Project's knowledge after a Space move (`moveOnce`), after
		 * the reconciles of both folders that are under way. Its next
		 * reconcile copies the content to the new Space's Host.
		 */
		move(project: MovedProject): Promise<void> {
			const fromRoot = folders.folder(project.from.projectId);
			const toRoot = folders.folder(project.to.projectId);
			return locks.inTurn(fromRoot, () =>
				fromRoot === toRoot
					? moveOnce(project)
					: locks.inTurn(toRoot, () => moveOnce(project)),
			);
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

/**
 * Moves a knowledge folder to another place. When that place has a
 * folder already, each file goes into it, unless the file there is
 * newer. The old folder goes.
 */
async function moveFolder(from: string, to: string): Promise<void> {
	if ((await stat(to).catch(() => null)) === null) {
		await mkdir(dirname(to), { recursive: true });
		await rename(from, to);
		return;
	}
	const { files } = await scanFolder(from);
	for (const file of files) {
		const target = join(to, ...file.path.split("/"));
		if (!(await inFolder(to, file.path))) continue;
		const there = await stat(target).catch(() => null);
		if (there && there.mtimeMs >= file.changedAt) continue;
		await mkdir(dirname(target), { recursive: true });
		await rename(join(from, ...file.path.split("/")), target);
	}
	await rm(from, { recursive: true, force: true });
}

async function readState(root: string): Promise<State | null> {
	const text = await readFile(
		join(root, KNOWLEDGE_RECONCILE_FILE),
		"utf8",
	).catch(() => null);
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
	await writeWhole(join(root, KNOWLEDGE_RECONCILE_FILE), JSON.stringify(state));
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
