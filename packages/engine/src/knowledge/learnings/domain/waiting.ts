import {
	learningPreface,
	PROPOSED_LEARNINGS_DIR,
	parseLearnings,
	proposedLearningAt,
	withoutNote,
} from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";

/**
 * Learnings: what agents propose to learn about a project, in its
 * knowledge. `learnings/` is Night Shift's own folder there. Each step's
 * proposed learnings wait in `learnings/proposed/<runId>.<stepId>.md`, one
 * note per `- ` line, until a person keeps them (into `learnings/accepted/`,
 * where agents read them) or deletes them. The index, search and
 * `read_knowledge` leave them out.
 *
 * One file per step, not per run: two steps of one run can run at once on
 * two Devices, and the reconcile keeps one change of a path, the later
 * one. Files of their own keep both.
 *
 * The file's text and the path rule are in `flows` (`learning-file.ts`,
 * `layout.ts`), because the agents' reports, the web app and the shell of
 * `kit:knowledge/review-learnings` need them too. That kit is the second
 * form of `settle`: `learnings-kit.test.ts` runs both.
 */

/** Another note that is close to a note, as the search compares them (`CloseNote` of `search`). */
export type NearNote = {
	/** The name of the file it is in. */
	id: string;
	/** Its text, so a person can compare the two. */
	note: string;
	/** A person kept it, and agents read it. Otherwise it waits too. */
	kept: boolean;
	/** The cosine of the two, 3 decimals. It says how close, not whether they agree. */
	similarity: number;
};

/** A note the search compares: one that waits, or one a person kept. */
export type ComparedNote = { id: string; text: string; kept: boolean };

/** One step's proposed learnings that wait for a person, as the review lists them. */
export type WaitingLearning = {
	/** The name of its file in `learnings/proposed/`: what keeps or deletes it. */
	id: string;
	/** The run whose step proposed it. */
	runId: string;
	/** That step. Null for a proposal of a run from before steps had files of their own. */
	stepId: string | null;
	/** What the agent proposed to learn, one note each. Empty: its text cannot be read now. */
	notes: string[];
	/** Epoch ms: when the step last added to it. */
	proposedAt: number;
	/**
	 * The notes close to each note, one list per note of `notes`, in their
	 * order. A person compares them. Absent: none is close, none could be
	 * compared yet, or Night Shift does not compare them here.
	 */
	nearTo?: NearNote[][];
};

/** A learning that waits, with the project it is for. */
export type ProjectLearning = WaitingLearning & { projectId: string };

/**
 * One note of a learning that waits: the file (`WaitingLearning.id`) and
 * its place in `notes`. `note`: its text as the person saw it. With it, a
 * note that moved in its file (another note of it was settled first) is
 * still found, and a note that is gone is refused, never another one.
 */
export type WaitingNote = { id: string; index: number; note?: string };

/** The person who keeps, deletes or tells a note: their id names their file, their name marks the note. */
export type NotePerson = { id: string; name: string };

/** A step of a run, as its proposed learnings are named. */
export type LearningStep = { runId: string; stepId?: string };

/** The path of a proposed file in the folder, by its name. */
export const proposedPath = (id: string) => `${PROPOSED_LEARNINGS_DIR}/${id}`;

/** No such learning waits any more: someone settled it. */
export const learningGone = () =>
	new Refusal(
		"not-found",
		"This learning no longer waits. Someone kept or deleted it.",
	);

/** The learning is listed in the Space, but its content did not reach this folder. */
export const learningUnavailable = () =>
	new Refusal(
		"unavailable",
		"Night Shift cannot get this learning now. Try again when the computer that keeps this Space is online.",
	);

/** The note is no longer in its file. */
export const noteGone = () =>
	new Refusal(
		"not-found",
		"This note no longer waits. Someone kept, changed or deleted it.",
	);

/** A person told an empty note. */
export const emptyNote = () => new Refusal("invalid", "Write the note first.");

/** Which files wait, with which content: when this changes, what waits changed. */
export function waitingKey(
	entries: Iterable<readonly [string, { sha256: string }]>,
): string {
	const keys: string[] = [];
	for (const [path, entry] of entries) {
		if (proposedLearningAt(path)) keys.push(`${path}:${entry.sha256}`);
	}
	return keys.sort().join("\n");
}

/** Newest first, and by name when two are as new. */
export function byNewest(
	a: Pick<WaitingLearning, "proposedAt" | "id">,
	b: Pick<WaitingLearning, "proposedAt" | "id">,
): number {
	return b.proposedAt - a.proposedAt || a.id.localeCompare(b.id);
}

/**
 * One note of a proposed file's text: found by its text when the person
 * saw one, else by its place. Gives the note, the file's lines before its
 * notes, and the file without it. Refuses a note the file no longer has.
 */
export function noteIn(
	text: string,
	at: WaitingNote,
): { note: string; preface: string; rest: { text: string; notes: number } } {
	const notes = parseLearnings(text);
	const index =
		at.note === undefined || notes[at.index] === at.note
			? at.index
			: notes.indexOf(at.note);
	const note = notes[index];
	const rest = withoutNote(text, index);
	if (note === undefined || rest === null) throw noteGone();
	return { note, preface: learningPreface(text), rest };
}

/**
 * Puts on each learning the notes close to each of its notes: `close`
 * has one list per note, in the order of the learnings and their notes. A
 * learning with no close note keeps no `nearTo`.
 */
export function withNearTo(
	learnings: readonly WaitingLearning[],
	close: readonly NearNote[][],
): WaitingLearning[] {
	let at = 0;
	return learnings.map((learning) => {
		const nearTo = learning.notes.map(() => close[at++] ?? []);
		return nearTo.some((near) => near.length > 0)
			? { ...learning, nearTo }
			: learning;
	});
}
