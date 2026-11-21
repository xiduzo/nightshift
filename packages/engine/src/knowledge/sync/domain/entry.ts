import { createHash } from "node:crypto";
import type { PageReaderSetting } from "@nightshift/flows";
import { z } from "zod";

/**
 * The knowledge document (ADR 4): the files of a Project's knowledge, in
 * one Yjs document per Project, `knowledge:<projectId>`. Every Device of
 * the Project's Space keeps a copy in its Replica, and the relay serves
 * it beside the flow documents. The content is not in it: a Device keeps
 * each file's content by its hash (the Space archive) and copies it to the
 * Space's Host.
 *
 * `files`: path → `{ sha256, size, changedAt, deviceId, local? }`, one
 * plain value per path. Entries merge per path: when two Devices change
 * one path, Yjs keeps one of them, and the next reconcile makes the later
 * change win (`reconcileFolder`). `local`: the file is larger than 10 MB
 * and stays on the Device that has it.
 *
 * `settings`: the project's knowledge settings, one plain value per name,
 * so every Device of the Space searches the same way. `meaning: false`:
 * search finds by words only for this project, though Ollama is there.
 * `learnFromRuns: false`: Night Shift proposes no learnings from the runs
 * of this project that ended (ADR 37). `reader`: the page reader of the
 * Web pages source and of the quick look (ADR 39), absent for Night
 * Shift's own: a value that does not read as a setting reads as absent.
 */

/** One file of the knowledge, as the document lists it. */
export type KnowledgeEntry = {
	/** The hash of its content: where the content is kept. */
	sha256: string;
	/** Bytes. */
	size: number;
	/** Epoch ms: when the Device that changed it last changed it. */
	changedAt: number;
	/** The Device that changed it last. */
	deviceId: string;
	/** Larger than 10 MB: it stays on `deviceId`, and other Devices do not fetch it. */
	local?: true;
};

const entrySchema = z.object({
	sha256: z.string().regex(/^[0-9a-f]{64}$/),
	size: z.number().int().min(0),
	changedAt: z.number().finite(),
	deviceId: z.string().min(1),
	local: z.literal(true).optional(),
});

/** A value of the document's `files` as an entry, or null when it is not a valid one. */
export function entryOf(value: unknown): KnowledgeEntry | null {
	const parsed = entrySchema.safeParse(value);
	if (!parsed.success) return null;
	const { local, ...entry } = parsed.data;
	return local ? { ...entry, local } : entry;
}

/** Knowledge content by its hash, in one Space. */
export type ContentRef = { kind: "content"; spaceId: string; sha256: string };

/** The hash of a content, as the Space archive keeps it. */
export function contentHash(content: Uint8Array): string {
	return createHash("sha256").update(content).digest("hex");
}

/**
 * One Project's knowledge document, as the knowledge reads and writes it.
 * Only its adapter knows it is Yjs.
 */
export type KnowledgeDocument = {
	/** The document's name in the Space: what a Replica keeps in step with its Host. */
	readonly name: string;
	/** Every valid entry, by path. */
	entries(): Map<string, KnowledgeEntry>;
	/**
	 * Whether the document never had an update: a new Replica's copy. Its
	 * files were not removed, it only does not list them yet.
	 */
	isNew(): boolean;
	/**
	 * Changes entries in one change, removals first. Resolves when this
	 * Replica has it. Nothing to change writes nothing.
	 */
	apply(change: {
		set?: readonly (readonly [string, KnowledgeEntry])[];
		delete?: readonly string[];
	}): Promise<void>;
	/**
	 * Every hash the document names, with an entry `entries` leaves out (a
	 * path that is no knowledge, a value of another version): what any
	 * Replica may still fetch.
	 */
	allHashes(): Set<string>;
	/** Whether search by meaning is on for the Project: on unless a person turned it off. */
	meaningOn(): boolean;
	/** Turns search by meaning on or off for the Project, for every Device of its Space. */
	setMeaning(on: boolean): Promise<void>;
	/**
	 * Whether Night Shift proposes learnings from the runs of the Project that
	 * ended (ADR 37): on unless a person turned it off.
	 */
	learnsFromRunsOn(): boolean;
	/** Turns the learnings from runs on or off for the Project, for every Device of its Space. */
	setLearnsFromRuns(on: boolean): Promise<void>;
	/** The page reader of the Project (ADR 39): Night Shift's own unless a person chose another. */
	reader(): PageReaderSetting;
	/** Chooses the page reader of the Project, for every Device of its Space. */
	setReader(setting: PageReaderSetting): Promise<void>;
};
