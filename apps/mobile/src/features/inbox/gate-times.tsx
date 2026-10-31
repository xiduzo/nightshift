import {
	deadlineText,
	type OpenGate,
	type RunDetail,
	waitedText,
} from "@nightshift/client";
import { Card } from "@nightshift/ui-native/components/ui/card";
import { Icon } from "@nightshift/ui-native/components/ui/icon";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { AlarmClock } from "lucide-react-native";
import { View } from "react-native";

import { Countdown, useClock } from "@/shared/clock";
import { StatusBadge } from "@/shared/status";
import { type Look, NEEDS_YOU } from "@/shared/tone";
import { StepTrail, trailItemOf } from "@/shared/trail";

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
 * What Night Shift picks when nobody answers, and the time left, counting
 * down each second.
 */
export function GateDeadline({
	deadline,
}: {
	deadline: NonNullable<OpenGate["deadline"]>;
}) {
	const now = useClock();
	return (
		<View className="flex-row items-start gap-2">
			<Icon as={AlarmClock} className="mt-0.5 size-4 text-muted-foreground" />
			<Text className="flex-1 text-muted-foreground text-sm">
				{deadlineText(deadline, now)}
			</Text>
			{deadline.at > now ? (
				<Countdown
					until={deadline.at}
					className="font-medium font-mono text-foreground text-sm tabular-nums"
				/>
			) : null}
		</View>
	);
}
