import { z } from "zod";
import { type NodeCheck, nodeBase } from "./base";

/** The End node: it ends the run on purpose, with a result, one line of text and maybe a report. */

/**
 * How an End node ends the run. `done`: the run did its work. `nothing-to-do`:
 * the run found no work, which is not a failure. `failed`: the flow chose to
 * fail, so a person looks at it.
 */
export const endStatusSchema = z.enum(["done", "nothing-to-do", "failed"]);
export type EndStatus = z.infer<typeof endStatusSchema>;

/**
 * A report the End node writes itself: `text`, a template that renders to
 * Markdown (`## What is new\n\n{{summary.output}}`).
 */
const textReportSchema = z.object({
	kind: z.literal("text"),
	text: z.string(),
});

/**
 * A report from a file the run wrote: `path`, a template that renders to a
 * path inside the folder the run works in (`reports/{{topic}}.md`). The
 * End step reads it on its Device, as UTF-8 text.
 */
const fileReportSchema = z.object({
	kind: z.literal("file"),
	path: z.string(),
});

/**
 * What the run produced, for a person to read (ADR 26): text the End node
 * writes, or a file the run wrote.
 */
const endReportSchema = z.discriminatedUnion("kind", [
	textReportSchema,
	fileReportSchema,
]);

/**
 * Ends the run with `status` and `message`, a template rendered to one line
 * ("No open issues"). The runs list, the run page and the notification show
 * both. No edge leaves it: its step ends with the status as its outcome, and
 * the run ends there.
 *
 * `report` is what the run produced, in Markdown: the run page, the flow's
 * card and Home show it. The step's outputs keep it, cut at
 * {@link MAX_REPORT_BYTES}. Night Shift never pushes it. A report file the
 * step cannot read (missing, not text, outside the folder) is a warning:
 * the run ends as the node says, without a report.
 *
 * In a called flow it ends the called flow: `done` and `nothing-to-do` end
 * the Call `pass`, `failed` ends it `fail`. The Call's `ended` holds the
 * status, its `end_message` the message and its `end_report` the report.
 */
export const endNodeSchema = z.object({
	...nodeBase,
	type: z.literal("end"),
	status: endStatusSchema,
	/** One line for a person. A template. */
	message: z.string().optional(),
	/** What the run produced, in Markdown. Unset: no report. */
	report: endReportSchema.optional(),
});
export type EndNode = z.infer<typeof endNodeSchema>;

/**
 * message: the rendered message, on one line. report: the rendered report,
 * at most {@link MAX_REPORT_BYTES}, only from a node with a report.
 */
export const endOutputFields = [
	"outcome",
	"message",
	"report",
	"visit",
] as const;

/**
 * The most bytes of a report a run keeps (UTF-8). The rest is cut at a
 * line break. The memory of a Since last run node has the same cap.
 */
export const MAX_REPORT_BYTES = 64 * 1024;

/**
 * The message an End node gives, from its rendered template: the first
 * line that is not blank, trimmed. Null when there is none.
 */
export function endMessage(rendered: string): string | null {
	const line = rendered
		.split("\n")
		.map((text) => text.trim())
		.find((text) => text !== "");
	return line ?? null;
}

/** A line feed in UTF-8: one byte, never part of a longer character. */
const LINE_FEED = 0x0a;

/**
 * The report an End node keeps, from its rendered template: without blank
 * lines on top and white space at the end, at most
 * {@link MAX_REPORT_BYTES} in UTF-8. A longer report is cut at the last
 * line break within the cap (`cut`). A report of one long line is cut
 * before the character the cap falls in. Empty when the report is blank.
 */
export function reportText(rendered: string): { text: string; cut: boolean } {
	const text = rendered.replace(/^(?:[ \t]*\r?\n)+/, "").trimEnd();
	const bytes = new TextEncoder().encode(text);
	if (bytes.length <= MAX_REPORT_BYTES) return { text, cut: false };
	// A line feed right after the cap still ends a whole line.
	let end = bytes.subarray(0, MAX_REPORT_BYTES + 1).lastIndexOf(LINE_FEED);
	if (end <= 0) {
		// No line break: cut before the character the cap falls in.
		end = MAX_REPORT_BYTES;
		while (end > 0 && ((bytes[end] ?? 0) & 0xc0) === 0x80) end -= 1;
	}
	return {
		text: new TextDecoder().decode(bytes.subarray(0, end)).trimEnd(),
		cut: true,
	};
}

/**
 * An End node's message and report read known names, and the path of a
 * report file stays inside the folder the run works in. That no edge
 * leaves it is a check of the flow's edges (`validateFlow`).
 */
export function checkEndNode(node: EndNode, check: NodeCheck): void {
	if (node.message !== undefined) check.template(node.message, "message");
	const { report } = node;
	if (report?.kind === "text") check.template(report.text, "report");
	if (report?.kind === "file") {
		check.template(report.path, "report file");
		const problem = reportPathProblem(report.path);
		if (problem !== null) {
			check.error(`The report file of "${node.id}" ${problem}`);
		}
	}
}

/**
 * Why the path of a report file does not name a file inside the folder
 * the run works in, as the end of a sentence; null when it does. Only the
 * node's own text counts: a part with a template is checked when the step
 * reads the file.
 */
function reportPathProblem(path: string): string | null {
	const text = path.trim();
	if (text === "") {
		return "has no path. Name the file the run writes, for example report.md.";
	}
	if (text.startsWith("/")) {
		return "starts with /. Give a path inside the folder the run works in, for example report.md.";
	}
	const parts = text.split("/").filter((part) => !part.includes("{{"));
	if (parts.includes("..")) {
		return 'leaves the folder the run works in. Remove ".." from the path.';
	}
	if (parts.includes(".git")) {
		return "is in .git. Pick a file the run writes.";
	}
	return null;
}
