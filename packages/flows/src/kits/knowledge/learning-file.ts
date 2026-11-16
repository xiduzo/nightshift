import { iso } from "@nightshift/time";

/**
 * The text of a proposed learning's file: Night Shift's header, then one
 * note per `- ` line. It is in `flows` because every layer that holds notes
 * must agree on it: the report of an agent (`agents`), the file (`engine`),
 * the transcript (`apps/web`) and the shell of the review kit.
 *
 * These words are on the disk of every Device and in the accepted learnings
 * agents read. Old files keep them, so a change here must still read those.
 */

/** What makes a line of the file a note. */
const NOTE_START = "- ";
/** The header's first line, before the start of the run's id. */
const TITLE_START = "# Learnings of run ";
/** The header's second line, around the run's id. */
const INTRO_START = "What the agents of run ";
const INTRO_END = " proposed to learn about this project";
/**
 * The second line of a run's own file (`<runId>.md`), before the run's id:
 * Night Shift looked back at the run when it ended (the Learner, ADR 37).
 */
const RUN_INTRO_START = "What Night Shift learned from run ";

/**
 * The notes as they are kept: each on one line and trimmed, the empty ones
 * left out. A report of an agent also limits how many notes it carries, and
 * how long each is (`step-report.ts` of `agents`). That is a limit of one
 * report, not of the file: a step can report twice, and a Command writes its
 * own file.
 */
export function learningNotes(notes: readonly string[]): string[] {
	return notes
		.map((note) => note.replace(/\s+/g, " ").trim())
		.filter((note) => note !== "");
}

/**
 * What to add to a file for these notes: the header when the file is new,
 * then one line per note. Empty when no note is left to keep. `by`: who
 * proposed them. `agents` (the default): the agents of a run's step, in the
 * step's file. `run`: Night Shift, when it looked back at the run, in the
 * run's own file.
 */
export function formatLearnings(
	notes: readonly string[],
	file: { runId: string; isNew: boolean; by?: "agents" | "run" },
): string {
	const lines = learningNotes(notes);
	if (lines.length === 0) return "";
	const { runId, isNew } = file;
	const intro =
		file.by === "run"
			? `${RUN_INTRO_START}${runId}.`
			: `${INTRO_START}${runId}${INTRO_END}.`;
	const head = isNew
		? `${TITLE_START}${runId.slice(0, 8)}\n\n${intro}\n\n`
		: "";
	return `${head}${lines.map((line) => `${NOTE_START}${line}`).join("\n")}\n`;
}

/** The notes of a file, in order: the text of each `- ` line that has any. */
export function parseLearnings(text: string): string[] {
	return text
		.split("\n")
		.filter(isNoteLine)
		.map((line) => line.slice(NOTE_START.length).trim());
}

/** Whether a line of a file is a note: what `parseLearnings` reads. */
function isNoteLine(line: string): boolean {
	return (
		line.startsWith(NOTE_START) && line.slice(NOTE_START.length).trim() !== ""
	);
}

/**
 * The file without its note at `index` (in the order of `parseLearnings`),
 * and how many notes it has left. Every other line stays as it was. Null:
 * the file has no note at that index.
 */
export function withoutNote(
	text: string,
	index: number,
): { text: string; notes: number } | null {
	const lines = text.split("\n");
	let at = -1;
	let line = -1;
	for (const [i, candidate] of lines.entries()) {
		if (!isNoteLine(candidate)) continue;
		at++;
		if (at === index) line = i;
	}
	if (line === -1) return null;
	lines.splice(line, 1);
	return { text: lines.join("\n"), notes: at };
}

/**
 * The lines of a file before its first note, without the blank lines at
 * their end: Night Shift's header, or what a Command wrote above its notes.
 * Empty when the file starts with a note.
 */
export function learningPreface(text: string): string {
	const lines = text.split("\n");
	const first = lines.findIndex(isNoteLine);
	return lines
		.slice(0, first === -1 ? lines.length : first)
		.join("\n")
		.trimEnd();
}

/** The header of the file that keeps the notes one person told. */
const TOLD_HEADER =
	"# Learnings people told\n\nWhat a person of this Space told agents about this project.";

/**
 * One note a person decided on, as `learnings/accepted/` keeps it: the note
 * on its `- ` line, then a line that says who and when. `told`: the person
 * wrote it. `kept`: an agent or Night Shift proposed it, and the person
 * kept it. The second line does not start with `- `, so no reader counts it
 * as a note, and Markdown shows it under its note. `isNew`: the file is new,
 * so the text starts with a header: the told one, else `preface` (the
 * proposed file's, `learningPreface`). Empty when the note is.
 */
export function formatPersonNote(
	note: string,
	mark: { how: "told" | "kept"; by: string; at: number },
	file: { isNew: boolean; preface?: string },
): string {
	const [line] = learningNotes([note]);
	if (line === undefined) return "";
	const who = mark.by.replace(/\s+/g, " ").trim() || "a person";
	const day = iso(mark.at).slice(0, 10);
	const head = !file.isNew
		? ""
		: mark.how === "told"
			? `${TOLD_HEADER}\n\n`
			: file.preface
				? `${file.preface}\n\n`
				: "";
	const how = mark.how === "told" ? "Told" : "Kept";
	return `${head}${NOTE_START}${line}\n  ${how} by ${who} on ${day}.\n`;
}

/** An id of a run, in the shell's awk. `layout.ts` holds the rule for a name. */
const RUN_ID_AWK = "[A-Za-z0-9_-]+";

/**
 * An awk program for the review kit's Gate: the text of the files as one JSON
 * string, without Night Shift's own header and blank lines. Each other line
 * stays, not only the notes. A Command can write its own file, and Keep adds
 * all of it to what agents read, so the Gate must not hide its text. The
 * header cannot hide any: its lines match only with one word for the run.
 *
 * Backslashes and quotes are escaped, tabs are spaces, lines are joined with
 * `\n`: JSON without jq. A backslash doubles through "&&" because what a
 * written "\\\\" gives in a replacement differs between awk programs.
 */
export const LEARNINGS_GATE_TEXT_AWK = String.raw`BEGIN { ORS = "" }
/^[ \t\r]*$/ { next }
/^${TITLE_START}${RUN_ID_AWK}\r?$/ { next }
/^${INTRO_START}${RUN_ID_AWK}${INTRO_END}\.\r?$/ { next }
/^${RUN_INTRO_START}${RUN_ID_AWK}\.\r?$/ { next }
{ gsub(/\\/, "&&"); gsub(/"/, "\\\""); gsub(/\t/, " "); gsub(/\r/, ""); print $0 "\\n" }`;
