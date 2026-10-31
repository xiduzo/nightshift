import {
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
	/** "12 min" */
	waited: string;
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
	>,
	now: number,
): GateRowText {
	const { headline, links } = gateParts(gate.question);
	const { flow } = gateRun(gate);
	return {
		overline: `${gate.projectName} · ${flow}`,
		title: plainText(headline),
		choices: choicesText(gate.choices.length),
		nodeId: gate.nodeId,
		waited: waitedText(now - gate.openedAt),
		pullRequest: links.some((link) => link.kind === "pull"),
	};
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
