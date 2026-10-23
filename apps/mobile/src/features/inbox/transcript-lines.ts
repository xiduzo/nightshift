import {
	gateParts,
	markdownPreview,
	type TranscriptEntry,
} from "@nightshift/client";

/**
 * A run's transcript as lines to read on a phone: what each agent said,
 * the commands and what they wrote, and what Night Shift did. Pure: the
 * transcript sheet follows the run and draws these.
 */

/**
 * Who a line is from:
 * - `step`: a step starts. Its text is the step's name.
 * - `agent`: what an agent said, or its report.
 * - `command`: a command line.
 * - `output`: what a command wrote.
 * - `night-shift`: what Night Shift did: a choice, a wait, an answer.
 */
export type TranscriptLineKind =
	| "step"
	| "agent"
	| "command"
	| "output"
	| "night-shift";

export type TranscriptLine = {
	key: string;
	kind: TranscriptLineKind;
	text: string;
};

/** The most lines the sheet keeps: the newest ones. */
export const MAX_LINES = 300;
/** The most characters of one command's output: its end. */
const MAX_OUTPUT = 2000;

/**
 * Folds transcript entries, in seq order, into lines. A step's lines open
 * with its name. Text deltas of one message join into one line, and the
 * output of one command into one line (its end, when it is long).
 */
export function transcriptLines(
	entries: readonly TranscriptEntry[],
	stepLabel: (stepId: string) => string,
): TranscriptLine[] {
	const lines: TranscriptLine[] = [];
	const at = new Map<string, number>();
	let step: string | null = null;
	const push = (line: TranscriptLine) => {
		at.set(line.key, lines.length);
		lines.push(line);
	};
	const append = (key: string, kind: TranscriptLineKind, text: string) => {
		const index = at.get(key);
		const line = index === undefined ? undefined : lines[index];
		if (index !== undefined && line) {
			lines[index] = { ...line, text: line.text + text };
		} else {
			push({ key, kind, text });
		}
	};

	for (const entry of entries) {
		const { event, seq, stepId } = entry;
		if (stepId !== step) {
			step = stepId;
			push({ key: `step:${seq}`, kind: "step", text: stepLabel(stepId) });
		}
		switch (event.type) {
			case "text":
				append(`text:${stepId}:${event.messageId}`, "agent", event.delta);
				break;
			case "report":
				if (event.summary.trim() !== "") {
					push({
						key: `report:${seq}`,
						kind: "agent",
						text: event.summary,
					});
				}
				break;
			case "error":
				push({ key: `error:${seq}`, kind: "night-shift", text: event.message });
				break;
			case "command-start":
				push({ key: `command:${seq}`, kind: "command", text: event.command });
				break;
			case "command-output": {
				const last = lines.at(-1);
				if (last?.kind === "output") {
					lines[lines.length - 1] = {
						...last,
						text: (last.text + event.text).slice(-MAX_OUTPUT),
					};
				} else {
					push({
						key: `output:${seq}`,
						kind: "output",
						text: event.text.slice(-MAX_OUTPUT),
					});
				}
				break;
			}
			case "command-exit":
				push({
					key: `exit:${seq}`,
					kind: "night-shift",
					text:
						event.exitCode === null
							? "The command stopped."
							: event.exitCode === 0
								? "The command finished."
								: "The command failed.",
				});
				break;
			case "decision":
				push({
					key: `decision:${seq}`,
					kind: "night-shift",
					text: event.notes.trim()
						? `Chose ${event.label}. ${event.notes.trim()}`
						: `Chose ${event.label}.`,
				});
				break;
			case "gate-open":
				push({
					key: `gate:${seq}`,
					kind: "night-shift",
					text: `Asks: ${gateParts(event.question).headline}`,
				});
				break;
			case "gate-resolved":
				push({
					key: `answer:${seq}`,
					kind: "night-shift",
					text: event.note.trim()
						? `Answered ${event.choice}. Note: ${event.note.trim()}`
						: `Answered ${event.choice}.`,
				});
				break;
			case "wait":
				push({ key: `wait:${seq}`, kind: "night-shift", text: event.message });
				break;
			default:
				break;
		}
	}
	const shown = lines
		.filter((line) => line.text.trim() !== "")
		.map((line) =>
			line.kind === "agent"
				? { ...line, text: markdownPreview(line.text, 1200) }
				: line,
		);
	// A step line with nothing after it says nothing.
	const kept = shown.filter(
		(line, index) => line.kind !== "step" || shown[index + 1]?.kind !== "step",
	);
	if (kept.at(-1)?.kind === "step") kept.pop();
	return kept.slice(-MAX_LINES);
}
