import type { PlannedSchedule } from "@nightshift/client";
import { Skeleton } from "@nightshift/ui-native/components/ui/skeleton";
import { Stack } from "expo-router";
import { CalendarClock } from "lucide-react-native";
import { View } from "react-native";

import { EmptyState } from "@/shared/empty";
import { ErrorAlert } from "@/shared/feedback";
import { useNow } from "@/shared/format";
import { ListGroup, SectionHead } from "@/shared/list";
import { Screen } from "@/shared/page";
import { ScheduleRow } from "./schedule-row";
import { planSummary, shownPaused } from "./schedule-words";
import {
	scheduleKey,
	usePendingPauses,
	useSchedulePlan,
} from "./use-schedule-plan";

/**
 * What runs tonight, and when: the schedules of the active Space, or of
 * one project, by their next start. The next 24 hours first, then later,
 * then the ones without a time (off, or on a webhook). Tap a schedule for
 * Pause tonight and Run now. Editing stays on the computer.
 */
export function SchedulesScreen({ projectId }: { projectId?: string }) {
	// Again every 30 s: a start moves from "today" to "tomorrow".
	const now = useNow();
	const { plan, entries, project, projectsLoaded, error, loading, refetch } =
		useSchedulePlan(projectId, now);
	const pending = usePendingPauses();
	const one = projectId !== undefined;

	const summary = entries.length > 0 ? planSummary(plan, now) : undefined;

	const section = (title: string, list: PlannedSchedule[], hint?: string) =>
		list.length > 0 ? (
			<View className="gap-3">
				<SectionHead title={title} hint={hint} />
				<ListGroup>
					{list.map((entry) => (
						<ScheduleRow
							key={scheduleKey(entry.projectId, entry.schedule.id)}
							projectId={entry.projectId}
							projectName={one ? undefined : entry.projectName}
							schedule={entry.schedule}
							paused={shownPaused(
								entry.schedule,
								now,
								pending.get(scheduleKey(entry.projectId, entry.schedule.id)),
							)}
							now={now}
						/>
					))}
				</ListGroup>
			</View>
		) : null;

	return (
		<Screen onRefresh={refetch} summary={summary}>
			<Stack.Screen
				options={{
					title: project ? `Schedules in ${project.name}` : "Schedules",
				}}
			/>
			{entries.length > 0 ? (
				<>
					{section("Next 24 hours", plan.soon, "Soonest first")}
					{section("Later", plan.later, "Soonest first")}
					{section("Off or on a webhook", plan.idle)}
				</>
			) : error ? (
				<ErrorAlert
					title="The schedules did not load"
					message={error.message}
					fix="Check that this phone is online, then try again."
					onRetry={() => void refetch()}
				/>
			) : loading ? (
				<Skeleton className="h-48 w-full rounded-xl" />
			) : one && projectsLoaded && !project ? (
				<ErrorAlert
					title="This project is not in this Space"
					message="It may belong to another Space."
					fix="Choose that Space on the Projects tab."
				/>
			) : (
				<EmptyState
					icon={CalendarClock}
					title="No schedules yet"
					description="Add a schedule on your computer. Then you see here what runs tonight."
				/>
			)}
		</Screen>
	);
}
