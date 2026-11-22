import { appendFile, mkdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { AgentEvent } from "@nightshift/agents/types";
import {
	ACCEPTED_LEARNINGS_DIR,
	formatLearnings,
	formatPersonNote,
	learningNotes,
	learningPreface,
	PROPOSED_LEARNINGS_DIR,
	parseLearnings,
	proposedLearningAt,
	proposedLearningFileName,
	proposedLearningOf,
	toldLearningFileName,
	withoutNote,
} from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import { now } from "@nightshift/time";
import { type SpaceArchive, writeWhole } from "../archive";
import type { KnowledgeFolders } from "./files";
import type { CloseNote, CloseNotes, NoteToCompare } from "./search";
import type {
	KnowledgeDocuments,
	KnowledgeReconciled,
	KnowledgeStepHold,
	SpaceHostStatus,
} from "./sync";

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
 * This module owns the protocol over the folder, the document and the
 * archive: what proposes, waits, counts and settles, and who hears that
 * what waits changed. The file's text and the path rule are in `flows`
 * (`learning-file.ts`, `layout.ts`), because the agents' reports, the web
 * app and the shell of `kit:knowledge/review-learnings` need them too. That
 * kit is the second form of `settle`: `learnings-kit.test.ts` runs both.
 * Which notes are close to others is `close-notes.ts`: this module only
 * gives it the notes and puts the answer on what waits.
 */

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
	nearTo?: CloseNote[][];
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
type LearningStep = { runId: string; stepId?: string };

/** Who tells the open screens of a Space's Members: `notifications` of the daemon, a layer above. */
export type LearningsNotifications = {
	/** What waits in a project changed. Quiet: a screen reads it again, and no push goes out. */
	learningsChanged(spaceId: string, projectId: string): Promise<void>;
};

type LearningsDeps = {
	folders: Pick<KnowledgeFolders, "folder">;
	documents: Pick<KnowledgeDocuments, "open">;
	/** The content by hash: here, and at the Space's Host. */
	archive: Pick<SpaceArchive, "here" | "read">;
	status: Pick<SpaceHostStatus, "spaceOf" | "heard">;
	/** Holds the folder as a step does: `settle` changes it, and the reconcile at `done` publishes that. */
	startStep(projectId: string): Promise<KnowledgeStepHold>;
	notifications: LearningsNotifications;
	/** Which notes are close to others. Absent: the list has no `nearTo`. */
	closeNotes?: Pick<CloseNotes, "among">;
};

export type Learnings = {
	/**
	 * Adds what an agent of a run's step proposes to learn to its file in
	 * the project's folder. The step holds the folder: the reconcile when
	 * the step ends puts it in the Space.
	 */
	propose(
		projectId: string,
		step: LearningStep,
		notes: readonly string[],
	): Promise<void>;
	/**
	 * Adds what Night Shift learned when it looked back at a run that ended
	 * (ADR 37) to the run's own file, `<runId>.md`. It holds the folder as a
	 * step does: the reconcile at its end puts the file in the Space. No
	 * note: nothing is written.
	 */
	proposeFromRun(
		projectId: string,
		runId: string,
		notes: readonly string[],
	): Promise<void>;
	/**
	 * The notes the project has, as this computer has them: the waiting ones,
	 * newest first, then the kept ones. No Host is asked. The look back at a
	 * run reads them, so it does not propose them again.
	 */
	known(projectId: string): Promise<string[]>;
	/**
	 * The session's events as they are, with the learnings of its reports
	 * proposed for the run's step. A note that cannot be kept is left out:
	 * the step goes on.
	 */
	keepReported(
		events: AsyncIterable<AgentEvent>,
		projectId: string,
		step: LearningStep,
	): AsyncGenerator<AgentEvent>;
	/**
	 * What waits for a person, newest first, with its notes, as the Space's
	 * document has it. No reconcile first: a step publishes what it proposed
	 * when it ends. A file whose content is neither here nor at the Host now
	 * has no notes. `onlyHere`: the Host is not asked, what is not here has
	 * no notes, and no note is compared. Without `onlyHere`, each carries the
	 * notes close to it (`nearTo`), from vectors made in the background: the
	 * read never waits for a model.
	 */
	waiting(
		projectId: string,
		options?: { onlyHere?: boolean },
	): Promise<WaitingLearning[]>;
	/**
	 * How many notes wait. A file whose content is not here holds one at
	 * least, and no Host is asked: the Knowledge page draws from this.
	 */
	count(projectId: string): Promise<number>;
	/**
	 * Keeps or deletes one step's proposed learnings: keep adds the file to
	 * `learnings/accepted/`, and both take it out of `learnings/proposed/`.
	 * Refuses a name that is no proposed learning, one that no longer waits,
	 * and one whose content cannot be fetched now.
	 */
	settle(
		projectId: string,
		id: string,
		decision: "keep" | "delete",
	): Promise<void>;
	/**
	 * Keeps or deletes one note of a learning that waits: keep adds it to
	 * the learning's file in `learnings/accepted/` with who kept it and when,
	 * and both take it out of the proposed file. A proposed file with no
	 * note left goes. Refuses as `settle` does, and a note the file no
	 * longer has.
	 */
	settleNote(
		projectId: string,
		note: WaitingNote,
		decision: "keep" | "delete",
		by: NotePerson,
	): Promise<void>;
	/**
	 * Keeps a note a person wrote, in their own file of `learnings/accepted/`
	 * (`told-<person>.md`) with who told it and when: agents read it. With
	 * `replaces`, the note takes the place of a note that waits, which leaves
	 * its proposed file as a delete does. Refuses an empty note, and a note
	 * to replace that no longer waits: then nothing is kept.
	 */
	tell(
		projectId: string,
		note: string,
		by: NotePerson,
		replaces?: WaitingNote,
	): Promise<void>;
	/**
	 * A reconcile ended. Every way what waits can change comes through here:
	 * a person who settles, a step's proposals, a review by the kit, and each
	 * of them on another Device. So one reconcile tells the screens once, and
	 * only when what waits is not what it was.
	 */
	reconciled(change: KnowledgeReconciled): Promise<void>;
};

/** Kept files each read compares with, at most: the newest. */
const MAX_KEPT_FILES = 500;

/** Which files wait, with which content: when this changes, what waits changed. */
function waitingKey(
	entries: Iterable<readonly [string, { sha256: string }]>,
): string {
	const keys: string[] = [];
	for (const [path, entry] of entries) {
		if (proposedLearningAt(path)) keys.push(`${path}:${entry.sha256}`);
	}
	return keys.sort().join("\n");
}

export function createLearnings(deps: LearningsDeps): Learnings {
	const { folders, documents, archive, status, notifications, closeNotes } =
		deps;
	/** What waited at the last reconcile of each project in this process. */
	const known = new Map<string, string>();

	/**
	 * The proposed learnings the document lists. Notes are null when the
	 * content cannot be read now. A Host that fails once is not asked again in
	 * this read, so many files do not each wait for it.
	 */
	async function listed(
		projectId: string,
		options: { onlyHere?: boolean } = {},
	) {
		const spaceId = await status.spaceOf(projectId);
		if (spaceId === null) return [];
		const entries = (await documents.open(projectId)).entries();
		const learnings = [];
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
				notes: content
					? parseLearnings(new TextDecoder().decode(content))
					: null,
				proposedAt: entry.changedAt,
			});
		}
		return learnings;
	}

	/** The notes kept in the project, as this computer has them: the Host is not asked. */
	async function keptNotes(projectId: string): Promise<NoteToCompare[]> {
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
					(text): NoteToCompare => ({
						id: path.slice(prefix.length),
						text,
						kept: true,
					}),
				);
			}),
		);
		return notes.flat();
	}

	/** What waited, with the notes close to each note. */
	async function withCloseNotes(
		projectId: string,
		learnings: WaitingLearning[],
	): Promise<WaitingLearning[]> {
		const waiting = learnings.flatMap(({ id, notes }) =>
			notes.map((text): NoteToCompare => ({ id, text, kept: false })),
		);
		if (!closeNotes || waiting.length === 0) return learnings;
		const close = await closeNotes.among(projectId, {
			notes: async () => [...waiting, ...(await keptNotes(projectId))],
			onPrepared: () => void tellScreens(projectId),
		});
		if (!close) return learnings;
		let at = 0;
		return learnings.map((learning) => {
			const nearTo = learning.notes.map(() => close[at++] ?? []);
			return nearTo.some((near) => near.length > 0)
				? { ...learning, nearTo }
				: learning;
		});
	}

	/** Lets the open screens of the project's Space read what waits again. */
	async function tellScreens(projectId: string): Promise<void> {
		const spaceId = await status.spaceOf(projectId);
		if (spaceId === null) return;
		await notifications
			.learningsChanged(spaceId, projectId)
			.catch((error: unknown) => {
				console.warn("The screens were not told of the learnings:", error);
			});
	}

	async function propose(
		projectId: string,
		step: LearningStep,
		notes: readonly string[],
		by: "agents" | "run" = "agents",
	): Promise<void> {
		const dir = join(
			folders.folder(projectId),
			...PROPOSED_LEARNINGS_DIR.split("/"),
		);
		const file = join(dir, proposedLearningFileName(step));
		const isNew = (await stat(file).catch(() => null)) === null;
		const text = formatLearnings(notes, { runId: step.runId, isNew, by });
		if (text === "") return;
		await mkdir(dir, { recursive: true });
		await appendFile(file, text);
	}

	/** No such learning waits any more: someone settled it. */
	const gone = () =>
		new Refusal(
			"not-found",
			"This learning no longer waits. Someone kept or deleted it.",
		);

	/**
	 * The text of a proposed file in this folder, by its name. Refuses a name
	 * that is no proposed learning, one that no longer waits, and one whose
	 * content did not reach this folder. The caller holds the folder.
	 */
	async function proposedText(
		projectId: string,
		id: string,
	): Promise<{ path: string; content: Buffer }> {
		if (!proposedLearningOf(id)) throw gone();
		const path = join(
			folders.folder(projectId),
			...PROPOSED_LEARNINGS_DIR.split("/"),
			id,
		);
		const content = await readFile(path).catch(() => null);
		if (content !== null) return { path, content };
		// Listed in the Space, but its content did not reach this folder.
		const isListed = (await documents.open(projectId))
			.entries()
			.has(`${PROPOSED_LEARNINGS_DIR}/${id}`);
		if (!isListed) throw gone();
		throw new Refusal(
			"unavailable",
			"Night Shift cannot get this learning now. Try again when the computer that keeps this Space is online.",
		);
	}

	/**
	 * One note of a proposed file, found by its text when the person saw
	 * one, else by its place. Refuses a note the file no longer has. The
	 * caller holds the folder.
	 */
	async function waitingNote(projectId: string, at: WaitingNote) {
		const { path, content } = await proposedText(projectId, at.id);
		const text = content.toString("utf8");
		const notes = parseLearnings(text);
		const index =
			at.note === undefined || notes[at.index] === at.note
				? at.index
				: notes.indexOf(at.note);
		const note = notes[index];
		const rest = withoutNote(text, index);
		if (note === undefined || rest === null) {
			throw new Refusal(
				"not-found",
				"This note no longer waits. Someone kept, changed or deleted it.",
			);
		}
		return {
			note,
			preface: learningPreface(text),
			/** Takes the note out of its file, and the file when no note is left. */
			take: () =>
				rest.notes === 0
					? rm(path, { force: true })
					: writeWhole(path, rest.text),
		};
	}

	/** Adds a note a person decided on to a file of `learnings/accepted/`. */
	async function accept(
		projectId: string,
		name: string,
		note: string,
		mark: { how: "told" | "kept"; by: NotePerson },
		preface?: string,
	): Promise<void> {
		const dir = join(
			folders.folder(projectId),
			...ACCEPTED_LEARNINGS_DIR.split("/"),
		);
		const file = join(dir, name);
		const isNew = (await stat(file).catch(() => null)) === null;
		const text = formatPersonNote(
			note,
			{ how: mark.how, by: mark.by.name, at: now() },
			{ isNew, ...(preface ? { preface } : {}) },
		);
		await mkdir(dir, { recursive: true });
		await appendFile(file, text);
	}

	return {
		propose,
		async proposeFromRun(projectId, runId, notes) {
			if (notes.length === 0) return;
			const hold = await deps.startStep(projectId);
			try {
				await propose(projectId, { runId }, notes, "run");
			} finally {
				await hold.done();
			}
		},
		async known(projectId) {
			const waiting = (await listed(projectId, { onlyHere: true }))
				.sort((a, b) => b.proposedAt - a.proposedAt)
				.flatMap((learning) => learning.notes ?? []);
			const kept = (await keptNotes(projectId)).map((note) => note.text);
			return [...waiting, ...kept];
		},
		async *keepReported(events, projectId, step) {
			for await (const event of events) {
				if (event.type === "report" && event.learnings?.length) {
					await propose(projectId, step, event.learnings).catch((error) =>
						console.warn("The learnings of a step were not kept:", error),
					);
				}
				yield event;
			}
		},
		async waiting(projectId, options) {
			const learnings = (await listed(projectId, options))
				.map((learning) => ({ ...learning, notes: learning.notes ?? [] }))
				.sort(
					(a, b) => b.proposedAt - a.proposedAt || a.id.localeCompare(b.id),
				);
			return options?.onlyHere
				? learnings
				: withCloseNotes(projectId, learnings);
		},
		async count(projectId) {
			const learnings = await listed(projectId, { onlyHere: true });
			return learnings.reduce(
				(sum, learning) => sum + (learning.notes?.length ?? 1),
				0,
			);
		},
		async settle(projectId, id, decision) {
			if (!proposedLearningOf(id)) throw gone();
			const hold = await deps.startStep(projectId);
			try {
				const { path, content } = await proposedText(projectId, id);
				if (decision === "keep") {
					const accepted = join(
						folders.folder(projectId),
						...ACCEPTED_LEARNINGS_DIR.split("/"),
					);
					await mkdir(accepted, { recursive: true });
					await appendFile(join(accepted, id), content);
				}
				await rm(path, { force: true });
			} finally {
				await hold.done();
			}
		},
		async settleNote(projectId, at, decision, by) {
			if (!proposedLearningOf(at.id)) throw gone();
			const hold = await deps.startStep(projectId);
			try {
				const found = await waitingNote(projectId, at);
				if (decision === "keep") {
					await accept(
						projectId,
						at.id,
						found.note,
						{ how: "kept", by },
						found.preface,
					);
				}
				await found.take();
			} finally {
				await hold.done();
			}
		},
		async tell(projectId, note, by, replaces) {
			if (learningNotes([note]).length === 0) {
				throw new Refusal("invalid", "Write the note first.");
			}
			if (replaces && !proposedLearningOf(replaces.id)) throw gone();
			const hold = await deps.startStep(projectId);
			try {
				// What it replaces is found first: when it is gone, nothing is kept.
				const replaced = replaces
					? await waitingNote(projectId, replaces)
					: null;
				await accept(projectId, toldLearningFileName(by.id), note, {
					how: "told",
					by,
				});
				await replaced?.take();
			} finally {
				await hold.done();
			}
		},
		async reconciled({ projectId, spaceId, held, listed: entries }) {
			const before = known.get(projectId) ?? waitingKey(Object.entries(held));
			const after = waitingKey(entries);
			known.set(projectId, after);
			if (before === after) return;
			await notifications
				.learningsChanged(spaceId, projectId)
				.catch((error: unknown) => {
					console.warn("The screens were not told of the learnings:", error);
				});
		},
	};
}
