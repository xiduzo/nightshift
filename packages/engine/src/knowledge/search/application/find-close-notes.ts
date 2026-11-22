import {
	type CloseNote,
	compare,
	type Hashed,
	hashOf,
	NOTES_BATCH,
	type NoteStates,
	type NoteToCompare,
} from "../domain/close-notes";
import { RETRY_MS } from "../domain/vector-states";
import type { MeaningModel, SearchIndex } from "./ports";

export type FindCloseNotesPorts = {
	index: Pick<
		SearchIndex,
		| "open"
		| "isOpen"
		| "healing"
		| "noteVectors"
		| "noteHashes"
		| "writeNoteVectors"
		| "keepNoteVectors"
	>;
	/** The model now: null once the search closed for good. */
	meaning: MeaningModel;
	/** Whether a person left search by meaning on for the project. Never throws. */
	meaningOn(projectId: string): Promise<boolean>;
	notes: NoteStates;
	clock: () => number;
};

/**
 * The project, and its notes to compare. `notes` runs only when the project
 * compares notes. `onPrepared`: a note that had no vector got one in the
 * background.
 */
export type FindCloseNotes = {
	projectId: string;
	notes: () => Promise<readonly NoteToCompare[]>;
	onPrepared: () => void;
};

/**
 * Finds which notes of a project's learnings are close in meaning: for each
 * note, the others close to it, in the order given. Two kept notes are not
 * compared, so a kept note gets none. Null: this project compares no notes
 * on this computer. Reads what the index holds: it never waits for a model,
 * and what the model embedded before still counts while it does not answer.
 * A broken index gives null too. A note with no vector yet gets one in the
 * background.
 */
export const findCloseNotes = (ports: FindCloseNotesPorts) => {
	const { index, notes: states, clock } = ports;

	function request(
		projectId: string,
		notes: readonly Hashed[],
		onPrepared: () => void,
	): void {
		const project = states.projectOf(projectId);
		project.wanted = { notes, onPrepared };
		if (project.queued) return;
		if (project.failedAt !== null && clock() - project.failedAt < RETRY_MS) {
			return;
		}
		project.queued = true;
		states.enqueue(() => prepare(projectId));
	}

	/** Embeds the notes with no vector yet, in the background. Never throws. */
	async function prepare(projectId: string): Promise<void> {
		const project = states.projectOf(projectId);
		let wrote = false;
		try {
			const model = ports.meaning.current();
			if (
				!model ||
				model.closeNotesAt === undefined ||
				!(await ports.meaningOn(projectId)) ||
				(await model.ready()) !== "ready"
			) {
				return;
			}
			await index.open();
			for (;;) {
				const notes = project.wanted?.notes ?? [];
				const held = index.noteHashes(projectId, model.model);
				const missing = new Map<string, string>();
				for (const note of notes) {
					if (!held.has(note.hash)) missing.set(note.hash, note.text);
				}
				if (missing.size === 0) break;
				const batch = [...missing].slice(0, NOTES_BATCH);
				const vectors = await model.embeddings.embedDocuments(
					batch.map(([, text]) => text),
				);
				// Closed or another model meanwhile: these vectors belong to nothing now.
				if (ports.meaning.current()?.model !== model.model || !index.isOpen()) {
					return;
				}
				index.writeNoteVectors(
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
				index.keepNoteVectors(
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

	return async ({
		projectId,
		notes: read,
		onPrepared,
	}: FindCloseNotes): Promise<CloseNote[][] | null> => {
		const model = ports.meaning.current();
		const line = model?.closeNotesAt;
		if (!model || line === undefined) return null;
		if (!(await ports.meaningOn(projectId))) return null;
		try {
			const notes = (await read()).map((note) => ({
				...note,
				hash: hashOf(note.text),
			}));
			return await index.healing(async () => {
				await index.open();
				const project = states.projectOf(projectId);
				const key = JSON.stringify([
					model.model,
					line,
					notes.map(({ id, hash, kept }) => [id, hash, kept]),
				]);
				if (project.known?.key !== key) {
					const vectors = index.noteVectors(projectId, model.model);
					project.known = {
						key,
						close: compare(notes, vectors, line),
						missing: notes.some((note) => !vectors.has(note.hash)),
					};
				}
				if (project.known.missing) request(projectId, notes, onPrepared);
				return project.known.close;
			});
		} catch (error) {
			console.warn("The notes that wait could not be compared now:", error);
			return null;
		}
	};
};
