import {
	gateParts,
	gateRun,
	type OpenGate,
	plainText,
	type RunDetail,
	waitedText,
} from "@nightshift/client";
import { AlarmClock, CircleAlert } from "lucide-react-native";

import { useClock } from "@/shared/clock";
import {
	NativeSection,
	NativeTextRow,
	NativeTitleRow,
} from "@/shared/native-list";
import { useThemeColors } from "@/shared/theme";
import { StepTrail, trailItemOf } from "@/shared/trail";
import { urgentText } from "./gate-view";

/*
 * The parts of the Gate screen that show a time. Each keeps its time
 * current itself, on the shared clock, so the screen does not re-render
 * on a tick.
 */

/** "Needs you · 12 min", "Answered" or "Waiting 12 min". */
function statusText(
	{ sent, answerable }: { sent: boolean; answerable: boolean },
	waited: string,
): string {
	if (sent) return "Answered";
	return answerable ? `Needs you · ${waited}` : `Waiting ${waited}`;
}

/**
 * The head of a Gate as the first row of the page: where it is from
 * ("Acme › website › Fix the login bug"), the headline, then its status
 * and how long it waited, the flow and the step.
 */
export function GateHead({
	gate,
	manySpaces,
	sent,
	answerable,
	flowAndStep = true,
}: {
	gate: OpenGate;
	manySpaces: boolean;
	sent: boolean;
	answerable: boolean;
	/** Shows the flow and the step in the status line. */
	flowAndStep?: boolean;
}) {
	const now = useClock();
	const { headline } = gateParts(gate.question);
	const where = [
		manySpaces ? gate.spaceName : null,
		gate.projectName,
		gate.runTitle,
	]
		.filter(Boolean)
		.join(" › ");
	const caption = [
		statusText({ sent, answerable }, waitedText(now - gate.openedAt)),
		...(flowAndStep ? [gateRun(gate).flow, `Step ${gate.nodeId}`] : []),
	].join(" · ");
	return (
		<NativeSection>
			<NativeTitleRow
				overline={where}
				title={plainText(headline)}
				caption={caption}
			/>
		</NativeSection>
	);
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
		<StepTrail
			items={run.steps
				.filter((step) => step.scope === null)
				.map((step) =>
					trailItemOf(step, { labels, runStatus: run.status, now }),
				)}
		/>
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
	const { colors } = useThemeColors();
	const text = urgentText(gate, now);
	if (!text) return null;
	return (
		<NativeSection>
			<NativeTextRow
				icon={
					gate.deadline
						? { sf: "alarm", lucide: AlarmClock }
						: { sf: "exclamationmark.circle", lucide: CircleAlert }
				}
				iconColor={colors.destructive}
				text={`**${text.title}**`}
				note={text.description}
			/>
		</NativeSection>
	);
}
