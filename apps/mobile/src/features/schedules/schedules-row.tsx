import type { Href } from "expo-router";
import { CalendarClock } from "lucide-react-native";

import { useClock } from "@/shared/clock";
import { ListRow } from "@/shared/list";
import { nextStartLine } from "./schedule-words";
import { PLAN_TICK_MS, useSchedulePlan } from "./use-schedule-plan";

/** Schedules: the schedules of the active Space, or of one project with `projectId`. */
export function schedulesHref(projectId?: string): Href {
	return projectId
		? { pathname: "/schedules", params: { projectId } }
		: "/schedules";
}

/**
 * The row to Schedules, with the next start under it: "Next:
 * nightly-review, today 23:00". On Home for the active Space, on a
 * project page with `projectId`. It reads the schedules itself, so the
 * screen around it does not render again when they change.
 */
export function SchedulesRow({ projectId }: { projectId?: string }) {
	const now = useClock(PLAN_TICK_MS);
	const { plan } = useSchedulePlan(projectId, now);
	const next = nextStartLine(plan, now);
	return (
		<ListRow
			icon={CalendarClock}
			title="Schedules"
			caption={next ? `Next: ${next}` : "What runs tonight, and when"}
			href={schedulesHref(projectId)}
			accessibilityHint="Shows what runs tonight, with Pause tonight and Run now"
		/>
	);
}
