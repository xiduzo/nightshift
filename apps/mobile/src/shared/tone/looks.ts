import {
	type RunResult,
	type RunStatus,
	runStatusLabel,
	type StepState,
	type StepSummary,
} from "@nightshift/client";
import { DECISION_LABEL, NODE_TYPE_LABEL } from "@nightshift/flows";

/**
 * What a status means on screen, without React Native: its tone (the
 * color token), the name of its icon and its word. A tone never shows
 * alone: the icon and the word go with it. The web's run status badge and
 * outcome badge are the reference (`apps/web/src/features/runs/components/
 * run-status-badge.tsx`, `apps/web/src/features/flows/canvas/outcome-badge.tsx`).
 */

/**
 * The color tokens of `@nightshift/ui-native/global.css`: the run status
 * colors (`--color-status-*`), the outcome colors (`--color-outcome-*`)
 * and `neutral` (`muted-foreground`).
 */
export type Tone =
	| "running"
	| "waiting"
	| "sleeping"
	| "finished"
	| "stopped"
	| "failed"
	| "interrupted"
	| "pass"
	| "fail"
	| "needs-input"
	| "label"
	| "neutral";

/** The lucide icons a status can show, by name (`icons.ts` maps them). */
export type StatusIconName =
	| "loader"
	| "hourglass"
	| "moon"
	| "circle-check"
	| "circle-stop"
	| "circle-x"
	| "circle-alert"
	| "circle-dot"
	| "circle-dashed"
	| "message-question"
	| "hand";

/** A status, ready to show: tone, icon and word. */
export type Look = { tone: Tone; icon: StatusIconName; label: string };

/**
 * The Tailwind classes of a tone: `text` for an icon or a word, `badge`
 * for the border and tint of an outline Badge. Literal strings, so
 * Tailwind finds them.
 */
export const TONE_CLASS: Record<Tone, { text: string; badge: string }> = {
	running: {
		text: "text-status-running",
		badge: "border-status-running/40 bg-status-running/10",
	},
	waiting: {
		text: "text-status-waiting",
		badge: "border-status-waiting/40 bg-status-waiting/10",
	},
	sleeping: {
		text: "text-status-sleeping",
		badge: "border-status-sleeping/40 bg-status-sleeping/10",
	},
	finished: {
		text: "text-status-finished",
		badge: "border-status-finished/40 bg-status-finished/10",
	},
	stopped: {
		text: "text-status-stopped",
		badge: "border-status-stopped/40 bg-status-stopped/10",
	},
	failed: {
		text: "text-status-failed",
		badge: "border-status-failed/40 bg-status-failed/10",
	},
	interrupted: {
		text: "text-status-interrupted",
		badge: "border-status-interrupted/40 bg-status-interrupted/10",
	},
	pass: {
		text: "text-outcome-pass",
		badge: "border-outcome-pass/40 bg-outcome-pass/10",
	},
	fail: {
		text: "text-outcome-fail",
		badge: "border-outcome-fail/40 bg-outcome-fail/10",
	},
	"needs-input": {
		text: "text-outcome-needs-input",
		badge: "border-outcome-needs-input/40 bg-outcome-needs-input/10",
	},
	label: {
		text: "text-outcome-label",
		badge: "border-outcome-label/40 bg-outcome-label/10",
	},
	neutral: { text: "text-muted-foreground", badge: "border-border" },
};

const RUN_ICON: Record<RunStatus, StatusIconName> = {
	running: "loader",
	waiting: "hourglass",
	sleeping: "moon",
	finished: "circle-check",
	stopped: "circle-stop",
	failed: "circle-x",
	interrupted: "circle-alert",
};

/**
 * A run status, as the web shows it: "Running" in blue with a spinner icon.
 * A run an End node ended with nothing to do reads as such, quietly.
 */
export function runStatusLook(
	status: RunStatus,
	result: RunResult | null = null,
): Look {
	if (status === "finished" && result === "nothing-to-do") {
		return { tone: "neutral", icon: "circle-dashed", label: "Nothing to do" };
	}
	return {
		tone: status,
		icon: RUN_ICON[status],
		label: runStatusLabel(status),
	};
}

/** A Gate that waits for the person. */
export const NEEDS_YOU: Look = {
	tone: "waiting",
	icon: "hand",
	label: "Needs you",
};

/**
 * An open Gate, for the person who looks at it: it needs you, an answer is
 * on its way, or it waits for another person (you may only read it). The
 * same Gate reads the same on Home, the Inbox, Search, a project and a run.
 */
export function gateLook(gate: {
	canAnswer: boolean;
	answerPending: boolean;
}): Look {
	if (gate.answerPending) {
		return {
			tone: "neutral",
			icon: "circle-check",
			label: "Answer on its way",
		};
	}
	if (!gate.canAnswer) {
		return { tone: "neutral", icon: "hand", label: "Waits for another person" };
	}
	return NEEDS_YOU;
}

/** The outcomes with a fixed look. Any other outcome is a Decision label or a Gate choice. */
const OUTCOME: Record<string, Look> = {
	pass: { tone: "pass", icon: "circle-check", label: "Pass" },
	fail: { tone: "fail", icon: "circle-x", label: "Fail" },
	"needs-input": {
		tone: "needs-input",
		icon: "message-question",
		label: "Needs input",
	},
	interrupted: {
		tone: "interrupted",
		icon: "circle-alert",
		label: "Interrupted",
	},
	stopped: { tone: "stopped", icon: "circle-stop", label: "Stopped" },
};

/** The outcome a step ended on: pass, fail, needs input, or its own name ("approve"). */
export function outcomeLook(outcome: string): Look {
	return (
		(Object.hasOwn(OUTCOME, outcome) ? OUTCOME[outcome] : undefined) ?? {
			tone: "label",
			icon: "circle-dot",
			label: outcome,
		}
	);
}

/**
 * Where a step is, from `stepState` of `@nightshift/client` and its
 * outcome. In a sleeping run, the step that has not ended sleeps with it
 * (a Call step keeps running: one of the steps it called sleeps).
 */
export function stepLook(
	step: { state: StepState; outcome: string | null; nodeType?: string },
	runStatus?: RunStatus,
): Look {
	switch (step.state) {
		case "running":
			return runStatus === "sleeping" && step.nodeType !== "call"
				? runStatusLook("sleeping")
				: runStatusLook("running");
		case "waiting":
			return { tone: "waiting", icon: "hand", label: "Waiting for you" };
		case "failed":
			return runStatusLook("failed");
		case "stopped":
			return step.outcome === "interrupted"
				? runStatusLook("interrupted")
				: runStatusLook("stopped");
		case "done":
			return step.outcome
				? outcomeLook(step.outcome)
				: { tone: "finished", icon: "circle-check", label: "Done" };
	}
}

/** The lucide icons of a node type, by name (`icons.ts` maps them). */
export type StepKindIconName =
	| "bot"
	| "terminal"
	| "split"
	| "hand"
	| "function"
	| "variable"
	| "hourglass"
	| "plug"
	| "flag"
	| "merge";

/** What kind of step it is: its name (the one of `@nightshift/flows`) and icon. */
export type StepKind = { label: string; icon: StepKindIconName };

const NODE_ICON: Record<StepSummary["nodeType"], StepKindIconName> = {
	agent: "bot",
	command: "terminal",
	decision: "split",
	call: "function",
	value: "variable",
	wait: "hourglass",
	tool: "plug",
	end: "flag",
	join: "merge",
};

/** The kind of a step. A Decision that asks a person is a Gate. */
export function stepKind(
	step: Pick<StepSummary, "nodeType" | "gate">,
): StepKind {
	if (step.nodeType === "decision" && step.gate !== null) {
		return { label: DECISION_LABEL.person, icon: "hand" };
	}
	return {
		label: NODE_TYPE_LABEL[step.nodeType],
		icon: NODE_ICON[step.nodeType],
	};
}
