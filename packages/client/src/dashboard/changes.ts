import type { ChangeVerdict, FlowChange, FlowMove } from "./types";

/**
 * Before and after for a flow in words both apps can share: what a change
 * changed, how the runs compare, and what each next change to try asks you
 * to do, and why.
 */

/** How to write money and time spans. */
export type MoveFormat = {
	cost: (usd: number) => string;
	time: (ms: number) => string;
};

function count(n: number, one: string, many: string): string {
	return `${n} ${n === 1 ? one : many}`;
}

/** What a change changed: "Added 1 step, changed 5 steps, changed 2 edges". */
export function changeSummary(change: FlowChange): string {
	const parts = [
		change.added ? `added ${count(change.added, "step", "steps")}` : "",
		change.removed ? `removed ${count(change.removed, "step", "steps")}` : "",
		change.changed ? `changed ${count(change.changed, "step", "steps")}` : "",
		change.edges ? `changed ${count(change.edges, "edge", "edges")}` : "",
		change.settings ? "changed its settings" : "",
	].filter(Boolean);
	const text = parts.length > 0 ? parts.join(", ") : "changed the flow";
	return text.charAt(0).toUpperCase() + text.slice(1);
}

const VERDICT: Record<ChangeVerdict, string> = {
	better: "Better",
	same: "About the same",
	worse: "Worse",
	few: "Too few runs to tell",
};

/** The verdict of a comparison: "Better", "Too few runs to tell". */
export function verdictLabel(verdict: ChangeVerdict): string {
	return VERDICT[verdict];
}

/**
 * What a move does for the flow. `up`: the flow can need you less. `fix`:
 * runs break. `hold`: it keeps you in, or costs time.
 */
export type MoveTone = "up" | "fix" | "hold";

const TONE: Record<FlowMove["kind"], MoveTone> = {
	edge: "fix",
	loopLimit: "fix",
	setup: "fix",
	endsRuns: "fix",
	guard: "fix",
	sameAnswer: "up",
	unsure: "hold",
	notes: "hold",
	leftOpen: "hold",
	wait: "hold",
	loop: "hold",
	stalled: "hold",
	late: "hold",
	rate: "hold",
	nothing: "hold",
};

export function moveTone(move: Pick<FlowMove, "kind">): MoveTone {
	return TONE[move.kind];
}

const MOVE_TONE_LABEL: Record<MoveTone, string> = {
	up: "Can need you less",
	fix: "Stops runs",
	hold: "Keeps you in",
};

/** The tone in words, for a screen reader: "Stops runs". */
export function moveToneLabel(tone: MoveTone): string {
	return MOVE_TONE_LABEL[tone];
}

const SETUP: Record<Extract<FlowMove, { kind: "setup" }>["cause"], string> = {
	handoff: "Check that your computers can reach each other",
	usageLimit: "Check the usage limit of the agent",
	network: "Check the network of the computer that runs it",
	signedOut: "Sign in to the agent again",
};

const GUARD: Record<
	Extract<FlowMove, { kind: "guard" }>["guard"],
	{ title: string; did: string }
> = {
	budget: {
		title: "Make the work cheaper, or raise the spend limit",
		did: "reached the spend limit",
	},
	turns: {
		title: "Split the work into smaller steps, or raise the turn limit",
		did: "reached the turn limit",
	},
	looping: {
		title: "Give the step that repeats a way out",
		did: "went in circles",
	},
	max_steps: {
		title: "Find the loop that does not end",
		did: "reached the step limit",
	},
};

function quote(text: string, max = 90): string {
	const line = text.replace(/\s+/g, " ").trim();
	return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** A share as a whole percent: "75%". */
function percent(share: number): string {
	return `${Math.round(share * 100)}%`;
}

/**
 * A move in words: what it asks you to do (`title`), and the runs that
 * show why (`why`).
 */
export function moveText(
	move: FlowMove,
	format: MoveFormat,
): { title: string; why: string } {
	switch (move.kind) {
		case "edge":
			return {
				title: `Choose where “${move.outcome}” at ${move.nodeId} goes`,
				why: `${count(move.runs, "run", "runs")} stopped at ${move.nodeId}. No edge leaves it on “${move.outcome}”.`,
			};
		case "loopLimit":
			return {
				title: `Find why ${move.nodeId} keeps ending on “${move.outcome}”`,
				why: `${count(move.runs, "run", "runs")} stopped when the loop at ${move.nodeId} ran out of rounds.`,
			};
		case "setup":
			return {
				title: SETUP[move.cause],
				why: `${count(move.runs, "run", "runs")} could not do their work. A change to the flow does not fix this.`,
			};
		case "unsure":
			return {
				title: `Make the choice at ${move.nodeId} clearer, or add a rule`,
				why: `The model was not sure in ${move.unsure} of ${move.picked} choices.`,
			};
		case "sameAnswer":
			return move.deadline
				? {
						title: `Let a model choose at ${move.nodeId}, and ask you only when it is not sure`,
						why: `You chose “${move.choice}” ${move.times} of ${move.of} times.`,
					}
				: {
						title: `Let ${move.nodeId} go on with “${move.choice}” unless you object`,
						why: `You chose “${move.choice}” ${move.times} of ${move.of} times.`,
					};
		case "notes":
			return {
				title: `Turn your notes at ${move.nodeId} into instructions for ${move.step ?? "the step before it"}`,
				why: `You sent the work back ${move.notes} times with a note. The last one: “${quote(move.lastNote)}”`,
			};
		case "leftOpen":
			return {
				title: `Give ${move.nodeId} a deadline, or remove it`,
				why: `${move.open} of ${move.asked} runs ended while ${move.nodeId} waited for you.`,
			};
		case "wait":
			return {
				title: move.nodeId
					? `Give ${move.nodeId} a deadline, so runs go on when you are away`
					: "Give your Gates a deadline, so runs go on when you are away",
				why: move.nodeId
					? `Runs waited for you ${percent(move.share)} of their time. ${move.nodeId} waited ${format.time(move.waitMs)} each time it asked.`
					: `Runs waited for you ${percent(move.share)} of their time, ${format.time(move.waitMs)} a run.`,
			};
		case "loop":
			return {
				title: `Check whether ${move.nodeId} needs the extra rounds`,
				why: `${move.from} sent the run back to ${move.nodeId} on “${move.outcome}” ${count(move.times, "time", "times")}. The extra rounds cost ${format.cost(move.extraUsd)}.`,
			};
		case "endsRuns":
			return {
				title: move.agent
					? `Add a stronger agent at ${move.nodeId} for when it fails`
					: `Find why ${move.nodeId} ends runs`,
				why: `${move.runs} of ${move.of} runs ended at ${move.nodeId}.`,
			};
		case "guard":
			return {
				title: GUARD[move.guard].title,
				why: `Night Shift stopped ${count(move.runs, "run", "runs")}: ${move.runs === 1 ? "it" : "they"} ${GUARD[move.guard].did}.`,
			};
		case "stalled":
			return {
				title: `Split ${move.nodeId} into smaller steps`,
				why: `The agent at ${move.nodeId} showed no activity, and Night Shift stopped its step ${count(move.runs, "time", "times")}.`,
			};
		case "late":
			return {
				title: "Keep the computer that runs it awake at that time",
				why: `${move.late} of ${move.scheduled} scheduled runs started late, by ${format.time(move.usualMs)} on a usual run.`,
			};
		case "rate":
			return {
				title: "Rate one run in five",
				why:
					move.rated > 0
						? `You rated ${move.rated} of ${move.runs} runs, and ${move.useful} ${move.useful === 1 ? "was" : "were"} useful. That is too few to trust the flow without you.`
						: `You rated none of the ${move.runs} runs. Night Shift cannot tell yet if the results are good.`,
			};
		default:
			return {
				title: "Check for work before the agents start",
				why: `${move.nothing} of ${move.runs} runs found nothing to do.`,
			};
	}
}

/** The move `value` names, or undefined when it names none. */
export function moveKindOf(value: string): FlowMove["kind"] | undefined {
	return Object.hasOwn(TONE, value) ? (value as FlowMove["kind"]) : undefined;
}

/** The step a move is about, for a chat about it. */
export function moveStep(move: FlowMove): string | undefined {
	return "nodeId" in move && move.nodeId ? move.nodeId : undefined;
}
