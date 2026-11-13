import { type OpenGate, type RunDetail, waitedText } from "@nightshift/client";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui-native/components/ui/alert";
import { Card } from "@nightshift/ui-native/components/ui/card";
import { AlarmClock, CircleAlert } from "lucide-react-native";

import { useClock } from "@/shared/clock";
import { StatusBadge } from "@/shared/status";
import { type Look, NEEDS_YOU } from "@/shared/tone";
import { StepTrail, trailItemOf } from "@/shared/trail";
import { urgentText } from "./gate-view";

/*
 * The parts of the Gate screen that show a time. Each keeps its time
 * current itself, on the shared clock, so the screen does not re-render
 * on a tick.
 */

/** The Gate's status and how long it waited: "Needs you · 12 min". */
export function GateStatus({
	openedAt,
	sent,
	answerable,
}: {
	openedAt: number;
	sent: boolean;
	answerable: boolean;
}) {
	const now = useClock();
	const waited = waitedText(now - openedAt);
	const look: Look = sent
		? { tone: "finished", icon: "circle-check", label: "Answered" }
		: answerable
			? { ...NEEDS_YOU, label: `Needs you · ${waited}` }
			: { tone: "neutral", icon: "hourglass", label: `Waiting ${waited}` };
	return <StatusBadge look={look} />;
}

/** The steps of the run so far, with how long the running one takes. */
export function RunSteps({
	run,
	labels,
}: {
	run: RunDetail;
	labels: ReadonlyMap<string, string>;
}) {
	const now = useClock();
	return (
		<Card className="px-4 py-4">
			<StepTrail
				items={run.steps
					.filter((step) => step.scope === null)
					.map((step) =>
						trailItemOf(step, { labels, runStatus: run.status, now }),
					)}
			/>
		</Card>
	);
}

/**
 * Why the Gate is urgent, at its top: when you must answer and what
 * Night Shift picks when you do not (`urgentText`). Nothing for a Gate
 * without a deadline that is not for now.
 */
export function GateUrgent({
	gate,
}: {
	gate: Pick<OpenGate, "deadline" | "urgency" | "form">;
}) {
	const now = useClock();
	const text = urgentText(gate, now);
	if (!text) return null;
	return (
		<Alert
			icon={gate.deadline ? AlarmClock : CircleAlert}
			variant="destructive"
			accessibilityLiveRegion="polite"
		>
			<AlertTitle>{text.title}</AlertTitle>
			<AlertDescription>{text.description}</AlertDescription>
		</Alert>
	);
}
