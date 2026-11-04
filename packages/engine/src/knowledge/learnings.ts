import { appendFile, mkdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { AgentEvent } from "@nightshift/agents/types";
import {
	ACCEPTED_LEARNINGS_DIR,
	formatLearnings,
	PROPOSED_LEARNINGS_DIR,
	parseLearnings,
	proposedLearningAt,
	proposedLearningFileName,
	proposedLearningOf,
} from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import type { SpaceArchive } from "../archive";
import type { KnowledgeFolders } from "./folder";
import type { KnowledgeDocuments } from "./knowledge-document";
import type { KnowledgeReconciled, KnowledgeStepHold } from "./reconcile";
import type { SpaceHostStatus } from "./space-host-status";

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
};

/** A learning that waits, with the project it is for. */
export type ProjectLearning = WaitingLearning & { projectId: string };

/** A step of a run, as its proposed learnings are named. */
export type LearningStep = { runId: string; stepId?: string };

/** Who tells the open screens of a Space's Members: `notifications` of the daemon, a layer above. */
export type LearningsNotifications = {
	/** What waits in a project changed. Quiet: a screen reads it again, and no push goes out. */
	learningsChanged(spaceId: string, projectId: string): Promise<void>;
};

export type LearningsDeps = {
	folders: Pick<KnowledgeFolders, "folder">;
	documents: Pick<KnowledgeDocuments, "open">;
	/** The content by hash: here, and at the Space's Host. */
	archive: Pick<SpaceArchive, "here" | "read">;
	status: Pick<SpaceHostStatus, "spaceOf" | "heard">;
	/** Holds the folder as a step does: `settle` changes it, and the reconcile at `done` publishes that. */
	startStep(projectId: string): Promise<KnowledgeStepHold>;
	notifications: LearningsNotifications;
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
	 * has no notes. `onlyHere`: the Host is not asked, and what is not here
	 * has no notes.
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
	 * A reconcile ended. Every way what waits can change comes through here:
	 * a person who settles, a step's proposals, a review by the kit, and each
	 * of them on another Device. So one reconcile tells the screens once, and
	 * only when what waits is not what it was.
	 */
	reconciled(change: KnowledgeReconciled): Promise<void>;
};

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
	const { folders, documents, archive, status, notifications } = deps;
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

	async function propose(
		projectId: string,
		step: LearningStep,
		notes: readonly string[],
	): Promise<void> {
		const dir = join(
			folders.folder(projectId),
			...PROPOSED_LEARNINGS_DIR.split("/"),
		);
		const file = join(dir, proposedLearningFileName(step));
		const isNew = (await stat(file).catch(() => null)) === null;
		const text = formatLearnings(notes, { runId: step.runId, isNew });
		if (text === "") return;
		await mkdir(dir, { recursive: true });
		await appendFile(file, text);
	}

	return {
		propose,
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
			const learnings = await listed(projectId, options);
			return learnings
				.map((learning) => ({ ...learning, notes: learning.notes ?? [] }))
				.sort(
					(a, b) => b.proposedAt - a.proposedAt || a.id.localeCompare(b.id),
				);
		},
		async count(projectId) {
			const learnings = await listed(projectId, { onlyHere: true });
			return learnings.reduce(
				(sum, learning) => sum + (learning.notes?.length ?? 1),
				0,
			);
		},
		async settle(projectId, id, decision) {
			const gone = new Refusal(
				"not-found",
				"This learning no longer waits. Someone kept or deleted it.",
			);
			if (!proposedLearningOf(id)) throw gone;
			const hold = await deps.startStep(projectId);
			try {
				const root = folders.folder(projectId);
				const proposed = join(root, ...PROPOSED_LEARNINGS_DIR.split("/"), id);
				const content = await readFile(proposed).catch(() => null);
				if (content === null) {
					// Listed in the Space, but its content did not reach this folder.
					const isListed = (await documents.open(projectId))
						.entries()
						.has(`${PROPOSED_LEARNINGS_DIR}/${id}`);
					if (!isListed) throw gone;
					throw new Refusal(
						"unavailable",
						"Night Shift cannot get this learning now. Try again when the computer that keeps this Space is online.",
					);
				}
				if (decision === "keep") {
					const accepted = join(root, ...ACCEPTED_LEARNINGS_DIR.split("/"));
					await mkdir(accepted, { recursive: true });
					await appendFile(join(accepted, id), content);
				}
				await rm(proposed, { force: true });
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
