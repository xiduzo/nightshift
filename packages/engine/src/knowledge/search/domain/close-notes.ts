import { createHash } from "node:crypto";

/**
 * Close notes: which notes of a project's learnings are close in meaning to
 * another, so a person can compare them before they keep or delete. A cosine
 * cannot tell a note that repeats another from one that disagrees with it,
 * since both are about one thing (`docs/knowledge.md`, "Close notes"). So this
 * module says "close", and never which of the two it is. It decides nothing.
 *
 * The page's read only reads: it never asks the model, nor whether the
 * model is ready, so no embed can hold a page. A note with no vector yet is
 * not compared, and its vector comes in the background. When some came,
 * `onPrepared` lets the open screens read again. The vectors stay in the search
 * index by the hash of the note's text: a note embeds once, also when it moves
 * from waiting to kept, and also after a restart.
 *
 * Search by meaning off for the project, no model, or a model nobody measured
 * a line for: the read gives null, and asks for no notes and no vector.
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
export const NOTES_BATCH = 16;

export type Hashed = NoteToCompare & { hash: string };

export function hashOf(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}

/** For each note, the others at `line` or above, closest first. Two kept notes are not compared. */
export function compare(
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

/** What is known of a project's close notes on this computer. */
type NoteProject = {
	/** The last comparison. Each draw asks the same until a note or a vector changes. */
	known: { key: string; close: CloseNote[][]; missing: boolean } | null;
	/** The notes the last read wanted vectors for, with who hears when they came. */
	wanted: { notes: readonly Hashed[]; onPrepared: () => void } | null;
	queued: boolean;
	/** When the last preparation failed: the next waits `RETRY_MS`. */
	failedAt: number | null;
};

/** What this computer knows of the close notes of each project. */
export type NoteStates = ReturnType<typeof createNoteStates>;

/** The projects' close notes, and the one queue their vectors are made in: Ollama answers one request at a time. */
export function createNoteStates() {
	const projects = new Map<string, NoteProject>();
	let queue: Promise<void> = Promise.resolve();
	return {
		projectOf(projectId: string): NoteProject {
			let project = projects.get(projectId);
			if (!project) {
				project = { known: null, wanted: null, queued: false, failedAt: null };
				projects.set(projectId, project);
			}
			return project;
		},
		/** Runs `work` after the preparations before it. */
		enqueue(work: () => Promise<void>): void {
			queue = queue.then(work);
		},
		/** The vectors of the notes went with the index, or with another model. */
		vectorsGone(): void {
			for (const project of projects.values()) project.known = null;
		},
	};
}
