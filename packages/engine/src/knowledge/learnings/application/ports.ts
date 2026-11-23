import type { Permissions } from "@nightshift/auth";
import type { Actor } from "../../../contract";
import type { TranscriptEntry } from "../../../log";
import type { CloseNotes as SearchCloseNotes } from "../../search";
import type { KnowledgeStepHold, SpaceHostStatus } from "../../sync";
import type { EndedRun } from "../domain/look-back";

/**
 * The driven ports of knowledge/learnings. A port of its own has a real adapter,
 * an in-memory adapter and a contract suite in `adapters/out/`. Another
 * slice or package fills a port with `@filledBy`: the composition of the
 * package passes it to `wireLearnings`.
 */

/**
 * The files of `learnings/` in a project's knowledge folder on this
 * computer, by their path in the folder (`learnings/proposed/<id>`). The
 * real adapter is `fs-learning-folder.ts`.
 */
export type LearningFolder = {
	/** Whether the folder has the file. */
	has(projectId: string, path: string): Promise<boolean>;
	/** The file's bytes, or null: no such file. */
	bytes(projectId: string, path: string): Promise<Uint8Array | null>;
	/** The file's text (UTF-8), or null: no such file. */
	text(projectId: string, path: string): Promise<string | null>;
	/** Adds to the end of the file, and makes the file and its folders when they are not there. */
	append(
		projectId: string,
		path: string,
		data: string | Uint8Array,
	): Promise<void>;
	/** Writes the whole file at once: a reader never sees half of it. */
	write(projectId: string, path: string, text: string): Promise<void>;
	/** Removes the file. No file: nothing happens. */
	remove(projectId: string, path: string): Promise<void>;
};

/**
 * The knowledge document of a project, as the learnings read it: what the
 * Space lists, and the switch of the learnings from runs.
 * @filledBy engine/knowledge
 */
export type LearningEntries = {
	open(projectId: string): Promise<{
		/** The files the Space lists, by path. */
		entries(): ReadonlyMap<string, { sha256: string; changedAt: number }>;
		/** Whether Night Shift proposes learnings from the project's runs (ADR 37). */
		learnsFromRunsOn(): boolean;
		/** Turns the learnings from runs on or off, for every Device of the Space. */
		setLearnsFromRuns(on: boolean): Promise<void>;
	}>;
};

/**
 * The knowledge content by hash: here, and at the Space's Host.
 * @filledBy engine/archive
 */
export type ContentArchive = {
	/** Only what this computer has. */
	here: {
		read(ref: {
			kind: "content";
			spaceId: string;
			sha256: string;
		}): Promise<Uint8Array | null>;
	};
	/** Here, else at the Space's Host. */
	read(ref: {
		kind: "content";
		spaceId: string;
		sha256: string;
	}): Promise<Uint8Array | null>;
};

/**
 * The Space of a project, and what a failed call to its Host says.
 * @filledBy engine/knowledge
 */
export type SpaceStatus = Pick<SpaceHostStatus, "spaceOf" | "heard">;

/**
 * Holds a project's folder as a step does: what the learnings change
 * there goes to the Space when the hold ends.
 * @filledBy engine/knowledge
 */
export type FolderHolds = {
	startStep(projectId: string): Promise<KnowledgeStepHold>;
};

/**
 * Who tells the open screens of a Space's Members: `notifications` of the
 * daemon, a layer above.
 * @filledBy notifications
 */
export type LearningsNotifications = {
	/** What waits in a project changed. Quiet: a screen reads it again, and no push goes out. */
	learningsChanged(spaceId: string, projectId: string): Promise<void>;
};

/**
 * Which notes are close to others, from vectors made in the background.
 * @filledBy engine/knowledge
 */
export type CloseNotes = Pick<SearchCloseNotes, "among">;

/**
 * What the look back reads of the runs on this computer: the engine
 * (`Engine`).
 * @filledBy engine/wire
 */
export type RunsToLearnFrom = {
	/** Each run event that lands here. Only a run's end matters. */
	onLandedFacts(
		listener: (
			facts: readonly { kind: string; spaceId: string; runId: string }[],
		) => void,
	): () => void;
	/** Whether this computer walks the run. */
	runHere(runId: string): Promise<{ walkedHere: boolean } | null>;
	/** One Space, read as Night Shift (`NIGHT_SHIFT`): the look back acts for no Person. */
	space(
		spaceId: string,
		actor: Actor,
	): {
		getRun(runId: string): Promise<EndedRun>;
		listRuns(input: { projectId: string; limit?: number }): Promise<
			{
				id: string;
				flowName: string | null;
				createdAt: number;
				endedAt: number | null;
			}[]
		>;
		stepTranscript(
			runId: string,
			stepId: string,
			signal: AbortSignal,
		): Promise<{ entries: TranscriptEntry[] }>;
	};
};

/**
 * What the Learner is asked: the evidence of one run, and where its cost
 * goes. The Learner is a built-in agent of this computer.
 * @filledBy daemon
 */
export type AskLearner = (input: {
	evidence: string;
	spaceId: string;
	projectId: string;
	runId: string;
	signal: AbortSignal;
}) => Promise<string[]>;

/**
 * Who may act in a Space for a learnings request.
 * @filledBy engine/runs
 */
export type LearningsAccess = {
	openSpace(
		actor: Actor,
		request: { spaceId: string; need?: Permissions },
	): Promise<void>;
};
