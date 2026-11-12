import type { DashboardSummary, FlowHealthRow } from "./types";

/**
 * The watch over a flow, in words: its level, why it needed you, and how
 * it left its usual range. Both apps say it the same way.
 */

/** The watch over one flow. */
export type FlowWatch = NonNullable<FlowHealthRow["watch"]>;
/** The level of a flow. */
export type FlowLevel = NonNullable<FlowWatch["level"]>["level"];
/** One way a flow left its usual range. */
export type FlowSignal = FlowWatch["signals"][number];
/** One reason a flow needed you, at one node. */
export type AttentionCause = FlowWatch["attention"]["causes"][number];
/** The watch over every flow of a dashboard. */
export type SpaceWatch = NonNullable<DashboardSummary["watch"]>;
/** A flow that needs a look. */
export type WatchedFlow = SpaceWatch["flows"][number];

/** The levels, from the most of you to the least. */
export const FLOW_LEVELS = [
	"decide",
	"check",
	"own",
] as const satisfies readonly FlowLevel[];

const LEVEL: Record<FlowLevel, { label: string; hint: string }> = {
	decide: {
		label: "You decide",
		hint: "You stepped in on most of its last runs.",
	},
	check: {
		label: "You check",
		hint: "You stepped in on some of its last runs.",
	},
	own: {
		label: "On its own",
		hint: "You stepped in on none of its last runs.",
	},
};

export function flowLevelLabel(level: FlowLevel): string {
	return LEVEL[level].label;
}

/** What the level says about the last runs. */
export function flowLevelHint(level: FlowLevel): string {
	return LEVEL[level].hint;
}

const runsInRow = (count: number | undefined) => `${count ?? 1} runs in a row`;

/** What is unusual, as a row says it. */
export function signalTitle(signal: FlowSignal): string {
	switch (signal.kind) {
		case "failing":
			return (signal.count ?? 1) > 1
				? `Failed ${runsInRow(signal.count)}`
				: "Its last run failed";
		case "nothing":
			return `Nothing to do, ${runsInRow(signal.count)}`;
		case "cost":
			return "Its last run cost more than usual";
		case "length":
			return "Its last run took longer than usual";
		case "slow":
			return "Runs longer than usual";
	}
}

/** The usual range and the value now, in words. Null for a signal without numbers. */
export function signalFacts(
	signal: FlowSignal,
	format: { cost: (usd: number) => string; time: (ms: number) => string },
): { usual: string; now: string } | null {
	if (signal.now === undefined || signal.usual === undefined) return null;
	const say = signal.kind === "cost" ? format.cost : format.time;
	const { low, high } = signal.usual;
	return {
		usual: low === high ? say(high) : `${say(low)} to ${say(high)}`,
		now:
			signal.kind === "slow"
				? `${say(signal.now)}, still at work`
				: say(signal.now),
	};
}

/**
 * Where the value now sits against the usual range, each as a share of
 * the larger of the two ends, 0 to 100. Null for a signal without numbers.
 */
export function signalScale(
	signal: FlowSignal,
): { low: number; high: number; now: number } | null {
	if (signal.now === undefined || signal.usual === undefined) return null;
	const top = Math.max(signal.now, signal.usual.high);
	if (top <= 0) return null;
	const share = (value: number) => Math.round((value / top) * 100);
	return {
		low: share(signal.usual.low),
		high: share(signal.usual.high),
		now: share(signal.now),
	};
}

/** One signal of one flow, as an app remembers that you looked at it. */
export function signalId(flowKey: string, signal: FlowSignal): string {
	return `${flowKey}\n${signal.kind}\n${signal.since}`;
}

const CAUSE: Record<AttentionCause["reason"], string> = {
	gate: "You answered a Gate",
	ask: "You answered an Ask",
	resumed: "You continued a run",
	stopped: "You stopped a run",
	"took-over": "You took a run over",
};

/** What you did, as the list of causes says it. */
export function causeLabel(cause: AttentionCause): string {
	return CAUSE[cause.reason];
}

/** "3 fewer than the 30 days before", "the same as the 30 days before". */
export function againstBefore(
	now: number,
	before: number,
	span: string,
): string {
	if (now === before) return `the same as the ${span} before`;
	const by = Math.abs(now - before);
	return `${by} ${now < before ? "fewer" : "more"} than the ${span} before`;
}
