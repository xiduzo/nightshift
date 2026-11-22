import { describe, expect, test } from "bun:test";
import {
	fakeMeaning,
	inMemorySearchPorts,
} from "../adapters/out/in-memory-neighbours";
import { createNoteStates, type NoteToCompare } from "../domain/close-notes";
import type { MeaningEmbeddings } from "../domain/meaning";
import { findCloseNotes } from "./find-close-notes";

/** The use case findCloseNotes, on in-memory adapters. */

/** Car and vehicle are one thing, kitten another. */
const embeddings: MeaningEmbeddings & { calls: number } = {
	calls: 0,
	async embedDocuments(texts) {
		embeddings.calls += 1;
		return texts.map((text) => (/kitten/i.test(text) ? [0, 1] : [1, 0]));
	},
	embedQuery: async () => [1, 0],
};

function notesPorts(on = true) {
	const ports = inMemorySearchPorts();
	embeddings.calls = 0;
	return {
		...ports,
		find: findCloseNotes({
			index: ports.index,
			meaning: ports.meaning,
			meaningOn: async () => on,
			notes: createNoteStates(),
			clock: () => 1_000,
		}),
	};
}

const NOTES: NoteToCompare[] = [
	{ id: "a.md", text: "The car is fast.", kept: false },
	{ id: "b.md", text: "A vehicle is fast.", kept: false },
	{ id: "c.md", text: "A kitten sleeps.", kept: false },
];

/** Reads the notes until their vectors came in the background. */
async function prepared(find: ReturnType<typeof findCloseNotes>) {
	let told!: () => void;
	const came = new Promise<void>((resolve) => {
		told = resolve;
	});
	const first = await find({
		projectId: "p1",
		notes: async () => NOTES,
		onPrepared: () => told(),
	});
	await came;
	return first;
}

describe("findCloseNotes", () => {
	test("compares nothing and reads no notes without a measured line, or with the setting off", async () => {
		let read = 0;
		const notes = async () => {
			read += 1;
			return NOTES;
		};
		const none = notesPorts();
		none.meaning.set(fakeMeaning({ embeddings }));
		expect(
			await none.find({ projectId: "p1", notes, onPrepared: () => {} }),
		).toBeNull();
		const off = notesPorts(false);
		off.meaning.set(fakeMeaning({ embeddings, closeNotesAt: 0.9 }));
		expect(
			await off.find({ projectId: "p1", notes, onPrepared: () => {} }),
		).toBeNull();
		expect(read).toBe(0);
	});

	test("embeds the notes in the background, then shows each note the close ones", async () => {
		const t = notesPorts();
		t.meaning.set(fakeMeaning({ embeddings, closeNotesAt: 0.9 }));
		// The first read has no vectors yet: nothing is close.
		expect(await prepared(t.find)).toEqual([[], [], []]);
		const close = await t.find({
			projectId: "p1",
			notes: async () => NOTES,
			onPrepared: () => {},
		});
		expect(close).toEqual([
			[{ id: "b.md", note: "A vehicle is fast.", kept: false, similarity: 1 }],
			[{ id: "a.md", note: "The car is fast.", kept: false, similarity: 1 }],
			[],
		]);
		expect(embeddings.calls).toBe(1);
	});

	test("compares no two kept notes", async () => {
		const t = notesPorts();
		t.meaning.set(fakeMeaning({ embeddings, closeNotesAt: 0.9 }));
		const kept = NOTES.map((note) => ({ ...note, kept: true }));
		let told!: () => void;
		const came = new Promise<void>((resolve) => {
			told = resolve;
		});
		await t.find({
			projectId: "p1",
			notes: async () => kept,
			onPrepared: told,
		});
		await came;
		expect(
			await t.find({
				projectId: "p1",
				notes: async () => kept,
				onPrepared: () => {},
			}),
		).toEqual([[], [], []]);
	});
});
