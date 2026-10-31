import { type ScheduleSummary, scheduleName } from "@nightshift/client";
import type { Href } from "expo-router";
import { CalendarClock } from "lucide-react-native";
import { memo } from "react";

import { useClock } from "@/shared/clock";
import { ListRow } from "@/shared/list";
import { nextText, rowLook, whenLine } from "./schedule-words";
import { PLAN_TICK_MS } from "./use-schedule-plan";

/** The sheet of one schedule: what it does, and Pause tonight and Run now. */
export function scheduleHref(projectId: string, scheduleId: string): Href {
	return { pathname: "/schedule", params: { projectId, scheduleId } };
}

/**
 * One schedule in a list: its flow, the project (when the list holds
 * more than one), when it runs, and its next start at the end. Under the
 * title, "Paused tonight" or how its last start went. Tap opens its
 * sheet. Its props are plain values, so it renders again only when one
 * changes, or when the shared clock moves its day word.
 */
export const ScheduleRow = memo(function ScheduleRow({
	projectId,
	projectName,
	schedule,
	paused,
}: {
	projectId: string;
	/** The project, above the title. Leave it out in the list of one project. */
	projectName?: string;
	schedule: ScheduleSummary;
	/** Paused tonight, also while the pause is on its way. */
	paused: boolean;
}) {
	const now = useClock(PLAN_TICK_MS);
	const next = nextText(schedule, now);
	return (
		<ListRow
			icon={CalendarClock}
			title={scheduleName(schedule)}
			overline={projectName}
			status={rowLook(schedule, paused)}
			caption={whenLine(schedule)}
			value={next}
			valueLabel={
				schedule.enabled && !schedule.webhook && schedule.nextAt !== null
					? `next start ${next}`
					: next
			}
			href={scheduleHref(projectId, schedule.id)}
			accessibilityHint="Opens the schedule, with Pause tonight and Run now"
		/>
	);
});
