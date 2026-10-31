import { appendFile, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { AgentEvent, AgentSessionInput } from "@nightshift/agents/types";

/**
 * Learnings: what agents propose to learn about a project, in its
 * knowledge. `learnings/` is Night Shift's own folder there. Each run's
 * proposals wait in `learnings/proposed/<runId>.md`, one note per `- `
 * line, until a person keeps them (`kit:knowledge/review-learnings` moves
 * them into `learnings/accepted/`, where agents read them) or deletes
 * them. The index, search and `read_knowledge` leave the proposals out.
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

/** Whether a path is one run's proposals: `learnings/proposed/<runId>.md`. */
export function isProposalFile(path: string): boolean {
	return (
		isProposal(path) && path.endsWith(".md") && path.split("/").length === 3
	);
}

/** How many notes a proposal holds: one per `- ` line. */
export function notesIn(content: Uint8Array | string): number {
	const text =
		typeof content === "string" ? content : new TextDecoder().decode(content);
	return text.split("\n").filter((line) => line.startsWith("- ")).length;
}

/**
 * Adds what an agent of the run proposes to learn to
 * `learnings/proposed/<runId>.md` in the knowledge folder `root`, one note
 * per line, for a person to keep or delete.
 */
export async function proposeLearnings(
	root: string,
	runId: string,
	notes: readonly string[],
): Promise<void> {
	if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(runId)) {
		throw new Error(`"${runId}" is not an id.`);
	}
	const lines = notes
		.map((note) => note.replace(/\s+/g, " ").trim())
		.filter((note) => note !== "");
	if (lines.length === 0) return;
	const dir = join(root, ...PROPOSED_DIR.split("/"));
	await mkdir(dir, { recursive: true });
	const file = join(dir, `${runId}.md`);
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
 * kept as proposals of the run, for a person to review. A note that cannot
 * be kept is left out: the step goes on.
 */
export async function* keepLearnings(
	events: AsyncIterable<AgentEvent>,
	root: string,
	runId: string,
): AsyncGenerator<AgentEvent> {
	for await (const event of events) {
		if (event.type === "report" && event.learnings?.length) {
			await proposeLearnings(root, runId, event.learnings).catch((error) =>
				console.warn("The learnings of a step were not kept:", error),
			);
		}
		yield event;
	}
}
