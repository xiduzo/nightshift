import {
	ACCEPTED_LEARNINGS_DIR,
	formatPersonNote,
	parseLearnings,
	proposedLearningAt,
	proposedLearningOf,
} from "@nightshift/flows";
import {
	type ComparedNote,
	learningGone,
	learningUnavailable,
	proposedPath,
	type WaitingLearning,
} from "./waiting";

/**
 * The reads several use cases share: the proposed learnings the document
 * lists, the notes kept, and one proposed file by its name. Each takes
 * what it reads as functions (the use case's ports), so the order of the
 * reads is here once.
 */

/** Kept files each read compares with, at most: the newest. */
export const MAX_KEPT_FILES = 500;

type ContentRef = { kind: "content"; spaceId: string; sha256: string };

/** What the reads of the document and the content ask. */
export type ListedReads = {
	status: {
		spaceOf(projectId: string): Promise<string | null>;
		heard(spaceId: string, error: unknown): void;
	};
	documents: {
		open(projectId: string): Promise<{
			entries(): ReadonlyMap<string, { sha256: string; changedAt: number }>;
		}>;
	};
	archive: {
		here: { read(ref: ContentRef): Promise<Uint8Array | null> };
		read(ref: ContentRef): Promise<Uint8Array | null>;
	};
};

/** A proposed learning the document lists. `notes` is null when its content cannot be read now. */
export type ListedLearning = Omit<WaitingLearning, "notes" | "nearTo"> & {
	notes: string[] | null;
};

/**
 * The proposed learnings the document lists, in its order. Notes are null
 * when the content cannot be read now. A Host that fails once is not asked
 * again in this read, so many files do not each wait for it. `onlyHere`:
 * the Host is not asked at all.
 */
export async function listedLearnings(
	reads: ListedReads,
	projectId: string,
	options: { onlyHere?: boolean } = {},
): Promise<ListedLearning[]> {
	const { status, documents, archive } = reads;
	const spaceId = await status.spaceOf(projectId);
	if (spaceId === null) return [];
	const entries = (await documents.open(projectId)).entries();
	const learnings: ListedLearning[] = [];
	let onlyHere = options.onlyHere ?? false;
	for (const [path, entry] of entries) {
		const learning = proposedLearningAt(path);
		if (!learning) continue;
		const ref = { kind: "content" as const, spaceId, sha256: entry.sha256 };
		const content = await (onlyHere
			? archive.here.read(ref)
			: archive.read(ref)
		).catch((error: unknown) => {
			status.heard(spaceId, error);
			onlyHere = true;
			return null;
		});
		learnings.push({
			...learning,
			notes: content ? parseLearnings(new TextDecoder().decode(content)) : null,
			proposedAt: entry.changedAt,
		});
	}
	return learnings;
}

/** The notes kept in the project, as this computer has them: the Host is not asked. */
export async function keptNotes(
	reads: Pick<ListedReads, "documents"> & {
		status: Pick<ListedReads["status"], "spaceOf">;
		archive: Pick<ListedReads["archive"], "here">;
	},
	projectId: string,
): Promise<ComparedNote[]> {
	const { status, documents, archive } = reads;
	const spaceId = await status.spaceOf(projectId);
	if (spaceId === null) return [];
	const prefix = `${ACCEPTED_LEARNINGS_DIR}/`;
	const kept = [...(await documents.open(projectId)).entries()]
		.filter(([path]) => path.startsWith(prefix) && path.endsWith(".md"))
		.sort(([, a], [, b]) => b.changedAt - a.changedAt)
		.slice(0, MAX_KEPT_FILES);
	const notes = await Promise.all(
		kept.map(async ([path, entry]) => {
			const content = await archive.here
				.read({ kind: "content", spaceId, sha256: entry.sha256 })
				.catch(() => null);
			if (!content) return [];
			return parseLearnings(new TextDecoder().decode(content)).map(
				(text): ComparedNote => ({
					id: path.slice(prefix.length),
					text,
					kept: true,
				}),
			);
		}),
	);
	return notes.flat();
}

/**
 * Adds a note a person decided on to a file of `learnings/accepted/`,
 * with who decided and when (`at`). `preface`: the lines before the notes
 * of the file it came from, for a new file.
 */
export async function acceptNote(
	folder: {
		has(path: string): Promise<boolean>;
		append(path: string, text: string): Promise<void>;
	},
	name: string,
	note: string,
	mark: { how: "told" | "kept"; by: { name: string }; at: number },
	preface?: string,
): Promise<void> {
	const path = `${ACCEPTED_LEARNINGS_DIR}/${name}`;
	const isNew = !(await folder.has(path));
	const text = formatPersonNote(
		note,
		{ how: mark.how, by: mark.by.name, at: mark.at },
		{ isNew, ...(preface ? { preface } : {}) },
	);
	await folder.append(path, text);
}

/**
 * A proposed file of this folder by its name, as `read` gives it. Refuses
 * a name that is no proposed learning, one that no longer waits, and one
 * whose content did not reach this folder. The caller holds the folder.
 */
export async function proposedFile<T>(
	id: string,
	read: (path: string) => Promise<T | null>,
	listed: () => Promise<ReadonlyMap<string, unknown>>,
): Promise<{ path: string; content: T }> {
	if (!proposedLearningOf(id)) throw learningGone();
	const path = proposedPath(id);
	const content = await read(path);
	if (content !== null) return { path, content };
	// Listed in the Space, but its content did not reach this folder.
	if (!(await listed()).has(path)) throw learningGone();
	throw learningUnavailable();
}
