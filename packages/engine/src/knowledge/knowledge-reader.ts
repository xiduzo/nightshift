import {
	isProposedLearning,
	isProposedLearningFile,
	isQuestionSetPath,
	PROPOSED_LEARNINGS_DIR,
	proposedLearningOf,
} from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import type { SpaceArchive } from "../archive";
import { OLDER_HOST } from "../contract";
import {
	cleanPath,
	type KnowledgeFolders,
	type KnowledgeReadFrom,
	type KnowledgeText,
	knowledgeText,
} from "./folder";
import type { KnowledgeFile } from "./folder-snapshot";
import type { KnowledgeDocuments } from "./knowledge-document";
import { notesIn, notesOf, type WaitingLearning } from "./learnings";
import type { SpaceHostStatus } from "./space-host-status";

/** What the Knowledge page lists: the document's files, and the learnings that wait. */
export type KnowledgeListing = {
	/** The files, the proposals left out, by path. */
	files: KnowledgeFile[];
	/** How many notes the proposals hold. */
	proposed: number;
	/** The Project's Space is not a personal one: each of its Members reads the knowledge. */
	shared: boolean;
	/**
	 * The Host that keeps the Space runs an older version of Night Shift:
	 * it cannot take this knowledge yet. This Device works on its own copy.
	 */
	olderHost: boolean;
};

export type KnowledgeReaderDeps = {
	folders: Pick<KnowledgeFolders, "read">;
	documents: Pick<KnowledgeDocuments, "open">;
	/** The content by hash: here, and at the Space's Host. */
	archive: Pick<SpaceArchive, "here" | "read">;
	status: SpaceHostStatus;
	/** This Device: a file larger than 10 MB can be read only on the Device that has it. */
	deviceId: string;
	/** A reconcile of the folder, unless a step writes it. Never fails. */
	reconcileUnlessHeld(projectId: string): Promise<unknown>;
	/** How long a page read waits for its reconcile. Default 2 s. */
	pageWaitMs?: number;
};

/**
 * The read side of a Project's knowledge: what the document lists, and one
 * file's text. It never changes the document or the folder. The merge
 * (`reconcile.ts`) does that.
 */
export type KnowledgeReader = ReturnType<typeof createKnowledgeReader>;

export function createKnowledgeReader(deps: KnowledgeReaderDeps) {
	const { folders, documents, archive, status, deviceId } = deps;
	return {
		/**
		 * The Knowledge page's list: a reconcile first, for a while, so the
		 * document has this Device's own changes. Then the document's files
		 * and how many notes its proposals hold. The reconcile goes on when
		 * the wait ends. While a step writes the folder, the page lists the
		 * document as it is.
		 */
		async listing(projectId: string): Promise<KnowledgeListing> {
			await Promise.race([
				deps.reconcileUnlessHeld(projectId),
				Bun.sleep(deps.pageWaitMs ?? 2_000),
			]);
			const spaceId = await status.spaceOf(projectId);
			const entries = (await documents.open(projectId)).entries();
			const files: KnowledgeFile[] = [];
			let proposed = 0;
			for (const [path, entry] of [...entries].sort(([a], [b]) =>
				a.localeCompare(b),
			)) {
				// The question set is Night Shift's own: the page shows it elsewhere.
				if (isQuestionSetPath(path)) continue;
				if (!isProposedLearning(path)) {
					files.push({
						path,
						size: entry.size,
						changedAt: entry.changedAt,
						...(entry.local ? { local: true as const } : {}),
					});
					continue;
				}
				if (!isProposedLearningFile(path)) continue;
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
				shared: spaceId ? await status.isShared(spaceId) : false,
				olderHost: spaceId ? status.isOlder(spaceId) : false,
			};
		},
		/**
		 * The proposals that wait for a person, newest first, with their
		 * notes, as the Space's document has them. No reconcile first: a
		 * step publishes its proposals when it ends. A proposal whose content
		 * is neither here nor at the Host now has no notes. `onlyHere`: the Host
		 * is not asked, and what is not here has no notes.
		 */
		async waitingLearnings(
			projectId: string,
			options: { onlyHere?: boolean } = {},
		): Promise<WaitingLearning[]> {
			const spaceId = await status.spaceOf(projectId);
			if (spaceId === null) return [];
			const entries = (await documents.open(projectId)).entries();
			const waiting: WaitingLearning[] = [];
			for (const [path, entry] of entries) {
				if (!isProposedLearningFile(path)) continue;
				const id = path.slice(PROPOSED_LEARNINGS_DIR.length + 1);
				const step = proposedLearningOf(id);
				if (!step) continue;
				const ref = { kind: "content" as const, spaceId, sha256: entry.sha256 };
				const content = await (options.onlyHere
					? archive.here.read(ref)
					: archive.read(ref)
				).catch((error: unknown) => {
					status.heard(spaceId, error);
					return null;
				});
				waiting.push({
					id,
					...step,
					notes: content ? notesOf(content) : [],
					proposedAt: entry.changedAt,
				});
			}
			return waiting.sort(
				(a, b) => b.proposedAt - a.proposedAt || a.id.localeCompare(b.id),
			);
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
			from?: KnowledgeReadFrom,
		): Promise<KnowledgeText | null> {
			// This computer's folder first: it may not have the file yet.
			const here = await folders.read(projectId, path, maxBytes, from);
			if (here) return here;
			const clean = cleanPath(path);
			if (clean === null) return null;
			const spaceId = await status.spaceOf(projectId);
			const entry = (await documents.open(projectId)).entries().get(clean);
			if (spaceId === null || !entry) return null;
			if (entry.local && entry.deviceId !== deviceId) {
				throw new Refusal(
					"unavailable",
					"This file is larger than 10 MB. It stays on the computer that synced it.",
				);
			}
			const content = await archive
				.read({ kind: "content", spaceId, sha256: entry.sha256 })
				.catch((error: unknown) => {
					status.heard(spaceId, error);
					return null;
				});
			if (!content && status.isOlder(spaceId)) {
				throw new Refusal("unavailable", OLDER_HOST);
			}
			if (!content) {
				throw new Refusal(
					"unavailable",
					"Night Shift cannot get this file now. Try again when the computer that keeps this Space is online.",
				);
			}
			return knowledgeText(clean, content, maxBytes, from);
		},
	};
}
