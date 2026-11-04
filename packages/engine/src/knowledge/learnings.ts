import { appendFile, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { AgentEvent } from "@nightshift/agents/types";
import {
	PROPOSED_LEARNINGS_DIR,
	proposedLearningFileName,
} from "@nightshift/flows";

/**
 * Learnings: what agents propose to learn about a project, in its
 * knowledge. `learnings/` is Night Shift's own folder there. Each step's
 * proposals wait in `learnings/proposed/<runId>.<stepId>.md`, one note per
 * `- ` line, until a person keeps them (`kit:knowledge/review-learnings` moves
 * them into `learnings/accepted/`, where agents read them) or deletes
 * them. The index, search and `read_knowledge` leave the proposals out.
 *
 * One file per step, not per run: two steps of one run can run at once on
 * two Devices, and the reconcile keeps one change of a path, the later
 * one. Files of their own keep both.
 */

/** How many notes a proposal holds: one per `- ` line. */
export function notesIn(content: Uint8Array | string): number {
	return linesOf(content).filter((line) => line.startsWith("- ")).length;
}

function linesOf(content: Uint8Array | string): string[] {
	const text =
		typeof content === "string" ? content : new TextDecoder().decode(content);
	return text.split("\n");
}

/** The notes of a proposal, in order: the text of each `- ` line. */
export function notesOf(content: Uint8Array | string): string[] {
	return linesOf(content)
		.filter((line) => line.startsWith("- "))
		.map((line) => line.slice(2).trim())
		.filter((note) => note !== "");
}

/** One step's proposals that wait for a person, as the review lists them. */
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

/** A step of a run, as its proposals are named. */
export type LearningStep = { runId: string; stepId?: string };

/**
 * Adds what an agent of a run's step proposes to learn to
 * `learnings/proposed/<runId>.<stepId>.md` in the knowledge folder `root`
 * (`<runId>.md` without a step), one note per line, for a person to keep
 * or delete.
 */
export async function proposeLearnings(
	root: string,
	step: LearningStep,
	notes: readonly string[],
): Promise<void> {
	const name = proposedLearningFileName(step);
	const { runId } = step;
	const lines = notes
		.map((note) => note.replace(/\s+/g, " ").trim())
		.filter((note) => note !== "");
	if (lines.length === 0) return;
	const dir = join(root, ...PROPOSED_LEARNINGS_DIR.split("/"));
	await mkdir(dir, { recursive: true });
	const file = join(dir, name);
	const isNew = (await stat(file).catch(() => null)) === null;
	const head = isNew
		? `# Learnings of run ${runId.slice(0, 8)}\n\nWhat the agents of run ${runId} proposed to learn about this project.\n\n`
		: "";
	await appendFile(
		file,
		`${head}${lines.map((line) => `- ${line}`).join("\n")}\n`,
	);
}

/**
 * The session's events as they are, with the learnings of its reports
 * kept as proposals of the run's step, for a person to review. A note that cannot
 * be kept is left out: the step goes on.
 */
export async function* keepLearnings(
	events: AsyncIterable<AgentEvent>,
	root: string,
	step: LearningStep,
): AsyncGenerator<AgentEvent> {
	for await (const event of events) {
		if (event.type === "report" && event.learnings?.length) {
			await proposeLearnings(root, step, event.learnings).catch((error) =>
				console.warn("The learnings of a step were not kept:", error),
			);
		}
		yield event;
	}
}
