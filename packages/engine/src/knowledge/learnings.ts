import { appendFile, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { AgentEvent, AgentSessionInput } from "@nightshift/agents/types";

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

/** Night Shift's own folder in the knowledge: no source fills it. */
export const LEARNINGS_DIR = "learnings";
/** The proposals that wait for a person. */
export const PROPOSED_DIR = `${LEARNINGS_DIR}/proposed`;

/** Whether a path of the knowledge is a proposal, or their folder. */
export function isProposal(path: string): boolean {
	return path === PROPOSED_DIR || path.startsWith(`${PROPOSED_DIR}/`);
}

/** Whether a folder of the knowledge is Night Shift's own, or in it. */
export function isLearningsFolder(folder: string): boolean {
	return folder === LEARNINGS_DIR || folder.startsWith(`${LEARNINGS_DIR}/`);
}

/** Whether a path is one step's proposals: `learnings/proposed/<runId>.<stepId>.md` (`<runId>.md` before). */
export function isProposalFile(path: string): boolean {
	return (
		isProposal(path) && path.endsWith(".md") && path.split("/").length === 3
	);
}

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

/** The learnings a person kept: agents read them. */
export const ACCEPTED_DIR = `${LEARNINGS_DIR}/accepted`;

/** Ids that become a part of a file name. */
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/**
 * One step's proposal, by the name of its file in `learnings/proposed/`
 * (`<runId>.<stepId>.md`, or `<runId>.md` before steps had files of their
 * own): its run and step. Null for a name that is not a proposal's.
 */
export function proposalOf(
	name: string,
): { runId: string; stepId: string | null } | null {
	if (!name.endsWith(".md")) return null;
	const parts = name.slice(0, -3).split(".");
	const [runId, stepId, ...rest] = parts;
	if (runId === undefined || rest.length > 0 || !ID.test(runId)) return null;
	if (stepId === undefined) return { runId, stepId: null };
	return ID.test(stepId) ? { runId, stepId } : null;
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
	const { runId, stepId } = step;
	for (const id of [runId, ...(stepId === undefined ? [] : [stepId])]) {
		if (!ID.test(id)) throw new Error(`"${id}" is not an id.`);
	}
	const lines = notes
		.map((note) => note.replace(/\s+/g, " ").trim())
		.filter((note) => note !== "");
	if (lines.length === 0) return;
	const dir = join(root, ...PROPOSED_DIR.split("/"));
	await mkdir(dir, { recursive: true });
	const file = join(
		dir,
		stepId === undefined ? `${runId}.md` : `${runId}.${stepId}.md`,
	);
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
 * The step report of an agent that reads the knowledge: it may add
 * `learnings`. A session without a report stays without one.
 */
export function withLearnings(
	stepReport: AgentSessionInput["stepReport"],
): AgentSessionInput["stepReport"] {
	if (!stepReport) return stepReport;
	return stepReport === true
		? { learnings: true }
		: { ...stepReport, learnings: true };
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
