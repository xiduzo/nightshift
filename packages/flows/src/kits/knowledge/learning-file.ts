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
 * What to add to a step's file for these notes: the header when the file is
 * new, then one line per note. Empty when no note is left to keep.
 */
export function formatLearnings(
	notes: readonly string[],
	file: { runId: string; isNew: boolean },
): string {
	const lines = learningNotes(notes);
	if (lines.length === 0) return "";
	const { runId, isNew } = file;
	const head = isNew
		? `${TITLE_START}${runId.slice(0, 8)}\n\n${INTRO_START}${runId}${INTRO_END}.\n\n`
		: "";
	return `${head}${lines.map((line) => `${NOTE_START}${line}`).join("\n")}\n`;
}

/** The notes of a file, in order: the text of each `- ` line that has any. */
export function parseLearnings(text: string): string[] {
	return text
		.split("\n")
		.filter((line) => line.startsWith(NOTE_START))
		.map((line) => line.slice(NOTE_START.length).trim())
		.filter((note) => note !== "");
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
 * `\n`: JSON without jq.
 */
export const LEARNINGS_GATE_TEXT_AWK = String.raw`BEGIN { ORS = "" }
/^[ \t\r]*$/ { next }
/^${TITLE_START}${RUN_ID_AWK}\r?$/ { next }
/^${INTRO_START}${RUN_ID_AWK}${INTRO_END}\.\r?$/ { next }
{ gsub(/\\/, "\\\\"); gsub(/"/, "\\\""); gsub(/\t/, " "); gsub(/\r/, ""); print $0 "\\n" }`;
