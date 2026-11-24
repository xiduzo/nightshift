import { gateOrder, mayAnswer, type OpenGate, urgencyOf } from "../gates";
import { type GlanceTone, glanceTone } from "./tone";

/** How many things a glance shows: the first in queue order. */
const GLANCE_ITEMS = 3;

/** One thing that needs you now, on a glance: its flow and why, nothing more. */
export type GlanceItem = {
	id: string;
	/** The flow's name, or "Quick run". */
	flow: string;
	/** "Answer by 07:30", "Waits for your answer" or "Needs a look". */
	detail: string;
	tone: GlanceTone;
};

/**
 * What the home screen widget shows: only what needs you now. That is
 * what a phone pushes for: the Gates marked Now that you may answer, and
 * the flows that need a look now. It holds only counts, flow names and
 * times, never what a Gate asks: a widget shows on a locked phone too.
 * Every text is ready to show, because a widget cannot format anything.
 */
export type GlanceSnapshot = {
	now: number;
	/** "Nothing needs you now", "1 thing needs you now", "3 things need you now". */
	nowText: string;
	/** The first things, Gates before flows, at most three. */
	items: GlanceItem[];
	/** The line under an empty widget: what waits for later, or nothing. */
	laterText: string;
};

/** The words for a count of things that need you now. */
export function nowText(count: number): string {
	if (count === 0) return "Nothing needs you now";
	return count === 1 ? "1 thing needs you now" : `${count} things need you now`;
}

/** "2 Gates wait for later" under an empty widget, or "" when none wait. */
function laterText(count: number): string {
	if (count === 0) return "";
	return count === 1
		? "1 Gate waits for later"
		: `${count} Gates wait for later`;
}

/** A flow that needs a look now: a flow with a severe signal. */
export type GlanceLook = { key: string; flow: string };

type GlanceGate = Pick<
	OpenGate,
	| "runId"
	| "stepId"
	| "flowName"
	| "canAnswer"
	| "answerPending"
	| "deadline"
	| "openedAt"
	| "urgency"
>;

/**
 * The widget's snapshot from the open Gates (of every Space) and the flows
 * that need a look now. A Gate counts when you may answer it and it is
 * marked Now. The other Gates only show as a count under an empty widget.
 * `time` writes a deadline as this phone shows times ("07:30").
 */
export function glanceSnapshot({
	gates,
	looks = [],
	time,
}: {
	gates: readonly GlanceGate[];
	looks?: readonly GlanceLook[];
	time: (epochMs: number) => string;
}): GlanceSnapshot {
	const open = gates.filter(mayAnswer);
	const nowGates = gateOrder(open.filter((gate) => urgencyOf(gate) === "now"));
	const items: GlanceItem[] = [
		...nowGates.map(
			(gate): GlanceItem => ({
				id: `gate:${gate.runId}:${gate.stepId}`,
				flow: gate.flowName ?? "Quick run",
				detail: gate.deadline
					? `Answer by ${time(gate.deadline.at)}`
					: "Waits for your answer",
				tone: glanceTone("waiting"),
			}),
		),
		...looks.map(
			(look): GlanceItem => ({
				id: `look:${look.key}`,
				flow: look.flow,
				detail: "Needs a look",
				tone: glanceTone("failed"),
			}),
		),
	];
	return {
		now: items.length,
		nowText: nowText(items.length),
		items: items.slice(0, GLANCE_ITEMS),
		laterText: laterText(open.length - nowGates.length),
	};
}

/**
 * The flows that need a look now, from the watch of a dashboard summary:
 * those with a severe signal, the severe first as the watch sorts them.
 * An older Host sends no watch: then none.
 */
export function glanceLooks(
	watch:
		| {
				flows: readonly {
					key: string;
					flow: string;
					signals: readonly { severe: boolean }[];
				}[];
		  }
		| undefined,
): GlanceLook[] {
	return (watch?.flows ?? [])
		.filter((flow) => flow.signals.some((signal) => signal.severe))
		.map((flow) => ({ key: flow.key, flow: flow.flow }));
}
