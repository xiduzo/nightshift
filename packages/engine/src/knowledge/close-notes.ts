import { createHash } from "node:crypto";
import { now } from "@nightshift/time";
import type { KnowledgeMeaning } from "./meaning";
import type { SearchStore } from "./search-store";
import { RETRY_MS } from "./vector-preparation";

/**
 * Close notes: which notes of a project's learnings are close in meaning to
 * another, so a person can compare them before they keep or delete. A cosine
 * cannot tell a note that repeats another from one that disagrees with it,
 * since both are about one thing (`docs/knowledge.md`, "Close notes"). So this
 * module says "close", and never which of the two it is. It decides nothing.
 *
 * The page's read only reads: `among` never asks the model, nor whether the
 * model is ready, so no embed can hold a page. A note with no vector yet is
 * not compared, and its vector comes in the background. When some came,
 * `onPrepared` lets the open screens read again. The vectors stay in the search
 * index by the hash of the note's text: a note embeds once, also when it moves
 * from waiting to kept, and also after a restart.
 *
 * Search by meaning off for the project, no model, or a model nobody measured
 * a line for: `among` gives null, and asks for no notes and no vector.
 */

/** A note to compare. `id` is the name of its file: in `learnings/proposed/`, or in `learnings/accepted/` when `kept`. */
export type NoteToCompare = { id: string; text: string; kept: boolean };

/** Another note that is close to a note. */
export type CloseNote = {
	/** The name of the file it is in. */
	id: string;
	/** Its text, so a person can compare the two. */
	note: string;
	/** A person kept it, and agents read it. Otherwise it waits too. */
	kept: boolean;
	/** The cosine of the two, 3 decimals. It says how close, not whether they agree. */
	similarity: number;
};

/** Close notes each note shows, at most: the closest. */
const MAX_PER_NOTE = 3;
/** Notes embedded in one call to the model. */
const EMBED_BATCH = 16;

type Hashed = NoteToCompare & { hash: string };

function hashOf(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}

/** For each note, the others at `line` or above, closest first. Two kept notes are not compared. */
function compare(
	notes: readonly Hashed[],
	vectors: ReadonlyMap<string, Float32Array>,
	line: number,
): CloseNote[][] {
	const close: CloseNote[][] = notes.map(() => []);
	const norms = new Map<string, number>();
	for (const [hash, vector] of vectors) {
		let sum = 0;
		for (const x of vector) sum += x * x;
		norms.set(hash, Math.sqrt(sum) || 1);
	}
	for (const [i, a] of notes.entries()) {
		const left = vectors.get(a.hash);
		if (!left) continue;
		const leftNorm = norms.get(a.hash) as number;
		for (let j = i + 1; j < notes.length; j++) {
			const b = notes[j] as Hashed;
			if (a.kept && b.kept) continue;
			const right = vectors.get(b.hash);
			if (!right || right.length !== left.length) continue;
			let dot = 0;
			for (let d = 0; d < left.length; d++) {
				dot += (left[d] as number) * (right[d] as number);
			}
			const similarity = Math.min(
				1,
				Math.round((dot / (leftNorm * (norms.get(b.hash) as number))) * 1000) /
					1000,
			);
			if (similarity < line) continue;
			if (!a.kept) {
				close[i]?.push({ id: b.id, note: b.text, kept: b.kept, similarity });
			}
			if (!b.kept) {
				close[j]?.push({ id: a.id, note: a.text, kept: a.kept, similarity });
			}
		}
	}
	return close.map((list) => {
		// One file can hold a note twice: to compare, once is enough.
		const seen = new Set<string>();
		return list
			.sort(
				(x, y) =>
					y.similarity - x.similarity ||
					x.id.localeCompare(y.id) ||
					x.note.localeCompare(y.note),
			)
			.filter(({ id, note, kept }) => {
				const key = JSON.stringify([id, note, kept]);
				if (seen.has(key)) return false;
				seen.add(key);
				return true;
			})
			.slice(0, MAX_PER_NOTE);
	});
}

type Project = {
	/** The last comparison. Each draw asks the same until a note or a vector changes. */
	known: { key: string; close: CloseNote[][]; missing: boolean } | null;
	/** The notes the last read wanted vectors for, with who hears when they came. */
	wanted: { notes: readonly Hashed[]; onPrepared: () => void } | null;
	queued: boolean;
	/** When the last preparation failed: the next waits `RETRY_MS`. */
	failedAt: number | null;
};

export type CloseNotes = ReturnType<typeof createCloseNotes>;

export function createCloseNotes(options: {
	store: Pick<
		SearchStore,
		| "open"
		| "isOpen"
		| "healing"
		| "noteVectors"
		| "noteHashes"
		| "writeNoteVectors"
		| "keepNoteVectors"
	>;
	/** The embedding model now. Null: search by meaning is off. */
	model: () => KnowledgeMeaning | null;
	/** Whether a person left search by meaning on for the project. Never throws. */
	meaningOn: (projectId: string) => Promise<boolean>;
	clock?: () => number;
}) {
	const { store, clock = now } = options;
	const projects = new Map<string, Project>();
	/** One preparation at a time: Ollama answers one request at a time. */
	let queue: Promise<void> = Promise.resolve();

	function projectOf(projectId: string): Project {
		let project = projects.get(projectId);
		if (!project) {
			project = { known: null, wanted: null, queued: false, failedAt: null };
			projects.set(projectId, project);
		}
		return project;
	}

	function request(
		projectId: string,
		notes: readonly Hashed[],
		onPrepared: () => void,
	): void {
		const project = projectOf(projectId);
		project.wanted = { notes, onPrepared };
		if (project.queued) return;
		if (project.failedAt !== null && clock() - project.failedAt < RETRY_MS) {
			return;
		}
		project.queued = true;
		queue = queue.then(() => prepare(projectId));
	}

	/** Embeds the notes with no vector yet, in the background. Never throws. */
	async function prepare(projectId: string): Promise<void> {
		const project = projectOf(projectId);
		let wrote = false;
		try {
			const model = options.model();
			if (
				!model ||
				model.closeNotesAt === undefined ||
				!(await options.meaningOn(projectId)) ||
				(await model.ready()) !== "ready"
			) {
				return;
			}
			await store.open();
			for (;;) {
				const notes = project.wanted?.notes ?? [];
				const held = store.noteHashes(projectId, model.model);
				const missing = new Map<string, string>();
				for (const note of notes) {
					if (!held.has(note.hash)) missing.set(note.hash, note.text);
				}
				if (missing.size === 0) break;
				const batch = [...missing].slice(0, EMBED_BATCH);
				const vectors = await model.embeddings.embedDocuments(
					batch.map(([, text]) => text),
				);
				// Closed or another model meanwhile: these vectors belong to nothing now.
				if (options.model()?.model !== model.model || !store.isOpen()) return;
				store.writeNoteVectors(
					projectId,
					model.model,
					batch.map(([hash], at) => ({
						hash,
						vector: vectors[at] as number[],
					})),
				);
				wrote = true;
				project.known = null;
			}
			if (wrote) {
				store.keepNoteVectors(
					projectId,
					(project.wanted?.notes ?? []).map((note) => note.hash),
				);
			}
			project.failedAt = null;
		} catch (error) {
			project.failedAt = clock();
			console.warn("The notes that wait could not be compared now:", error);
		} finally {
			project.queued = false;
			if (wrote) project.wanted?.onPrepared();
		}
	}

	return {
		/**
		 * For each note, the others close to it, in the order given. Two kept
		 * notes are not compared, so a kept note gets none. Null: this project
		 * compares no notes on this computer. Reads what the index holds: it
		 * never waits for a model, and what the model embedded before still
		 * counts while it does not answer. A broken index gives null too.
		 * `notes` runs only when the project compares notes. `onPrepared`: a
		 * note that had no vector got one in the background.
		 */
		async among(
			projectId: string,
			read: {
				notes: () => Promise<readonly NoteToCompare[]>;
				onPrepared: () => void;
			},
		): Promise<CloseNote[][] | null> {
			const model = options.model();
			const line = model?.closeNotesAt;
			if (!model || line === undefined) return null;
			if (!(await options.meaningOn(projectId))) return null;
			try {
				const notes = (await read.notes()).map((note) => ({
					...note,
					hash: hashOf(note.text),
				}));
				return await store.healing(async () => {
					await store.open();
					const project = projectOf(projectId);
					const key = JSON.stringify([
						model.model,
						line,
						notes.map(({ id, hash, kept }) => [id, hash, kept]),
					]);
					if (project.known?.key !== key) {
						const vectors = store.noteVectors(projectId, model.model);
						project.known = {
							key,
							close: compare(notes, vectors, line),
							missing: notes.some((note) => !vectors.has(note.hash)),
						};
					}
					if (project.known.missing) {
						request(projectId, notes, read.onPrepared);
					}
					return project.known.close;
				});
			} catch (error) {
				console.warn("The notes that wait could not be compared now:", error);
				return null;
			}
		},
		/** The vectors of the notes went with the index, or with another model. */
		vectorsGone(): void {
			for (const project of projects.values()) project.known = null;
		},
	};
}
