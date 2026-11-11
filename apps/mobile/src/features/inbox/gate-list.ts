import {
	type ContextItem,
	deadlineWhen,
	gateParts,
	gateRun,
	type OpenGate,
	plainText,
	waitedText,
} from "@nightshift/client";

/**
 * The words of one Gate's row, without React Native, and the Gate to
 * answer after this one.
 */

/** "1 choice", "3 choices". */
export function choicesText(count: number): string {
	return count === 1 ? "1 choice" : `${count} choices`;
}

/** The words of one Gate's row. Its status word is `gateLook` of `shared/tone`. */
export type GateRowText = {
	/** "website · Feature factory" */
	overline: string;
	/** The question itself. */
	title: string;
	/** "2 choices", then the node id in mono. */
	choices: string;
	nodeId: string;
	/**
	 * Why you decide, on one line: the Gate's situation, or else the first
	 * line of its question below the headline. Empty when it has neither.
	 */
	situation: string;
	/** "12 min" */
	waited: string;
	/** When it needs an answer: "by 12:00", "by 07:00 tomorrow". Null without a deadline. */
	due: string | null;
	/** The question links a pull request: the row shows its icon. */
	pullRequest: boolean;
};

export function gateRowText(
	gate: Pick<
		OpenGate,
		| "question"
		| "projectName"
		| "flowName"
		| "runTitle"
		| "choices"
		| "nodeId"
		| "openedAt"
		| "deadline"
		| "brief"
	>,
	now: number,
): GateRowText {
	const { headline, context, links } = gateParts(gate.question);
	const { flow } = gateRun(gate);
	return {
		overline: `${gate.projectName} · ${flow}`,
		title: plainText(headline),
		choices: choicesText(gate.choices.length),
		nodeId: gate.nodeId,
		situation: firstLine(gate.brief?.situation ?? "") || firstText(context),
		waited: waitedText(now - gate.openedAt),
		due: gate.deadline ? dueText(gate.deadline.at, now) : null,
		pullRequest: links.some((link) => link.kind === "pull"),
	};
}

/** The first line of a text that is not empty, as plain text. */
function firstLine(text: string): string {
	const line = text.split("\n").find((part) => part.trim() !== "");
	return line ? plainText(line) : "";
}

/** The first line of the question's prose below its headline. Code and labelled values do not count. */
function firstText(context: readonly ContextItem[]): string {
	for (const item of context) {
		if (item.kind !== "text" || item.label !== null) continue;
		const line = firstLine(item.value);
		if (line) return line;
	}
	return "";
}

/** When a deadline falls, short for a row: "by 12:00", "by 07:00 tomorrow". */
function dueText(at: number, now: number): string {
	const { time, day } = deadlineWhen(at, now);
	return `by ${time}${day}`;
}

/**
 * The Gate to answer after this one: the next one you may answer, in
 * inbox order (oldest first, as the Host sends `gates`). Null when
 * nothing else waits for you.
 */
export function nextGate<
	G extends Pick<
		OpenGate,
		"runId" | "stepId" | "openedAt" | "canAnswer" | "answerPending"
	>,
>(gates: readonly G[], current: Pick<OpenGate, "runId" | "stepId">): G | null {
	return (
		gates.find(
			(gate) =>
				gate.canAnswer &&
				!gate.answerPending &&
				(gate.runId !== current.runId || gate.stepId !== current.stepId),
		) ?? null
	);
}
