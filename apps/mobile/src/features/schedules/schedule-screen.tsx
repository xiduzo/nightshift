import {
	type ScheduleResult,
	type ScheduleSummary,
	scheduleName,
} from "@nightshift/client";
import { Skeleton } from "@nightshift/ui-native/components/ui/skeleton";
import { router, Stack } from "expo-router";
import { CalendarClock, FolderGit2 } from "lucide-react-native";

import { openRun } from "@/features/runs";
import { useClock } from "@/shared/clock";
import { ErrorAlert } from "@/shared/feedback";
import { ListGroup, ListRow } from "@/shared/list";
import { Screen } from "@/shared/page";
import { ScheduleNudges } from "./schedule-nudges";
import {
	lastLook,
	nextText,
	PAUSED_TONIGHT,
	shownPaused,
	startText,
	whenLine,
} from "./schedule-words";
import {
	PLAN_TICK_MS,
	scheduleKey,
	usePendingPauses,
	useSchedulePlan,
} from "./use-schedule-plan";

/**
 * One schedule, in a sheet from Schedules: when it runs, its next start,
 * how its last start went, and Pause tonight and Run now. Editing stays
 * on the computer.
 */
export function ScheduleScreen({
	projectId,
	scheduleId,
}: {
	projectId: string;
	scheduleId: string;
}) {
	const now = useClock(PLAN_TICK_MS);
	const { entries, project, projectsLoaded, error, loading, refetch } =
		useSchedulePlan(projectId, now);
	const pending = usePendingPauses();
	const entry = entries.find((e) => e.schedule.id === scheduleId);

	if (!entry) {
		return (
			<Screen onRefresh={refetch}>
				{error ? (
					<ErrorAlert
						title="This schedule did not load"
						message={error.message}
						fix="Check that this phone is online, then try again."
						onRetry={() => void refetch()}
					/>
				) : loading || !projectsLoaded ? (
					<Skeleton className="h-40 w-full rounded-xl" />
				) : (
					<ErrorAlert
						title="This schedule is not here"
						message="Someone may have removed it, or it belongs to another Space."
						fix="Go back to Schedules to see the list again."
					/>
				)}
			</Screen>
		);
	}

	const { schedule } = entry;
	const paused = shownPaused(
		schedule,
		now,
		pending.get(scheduleKey(projectId, scheduleId)),
	);
	return (
		<Screen onRefresh={refetch} summary={whenLine(schedule)}>
			<Stack.Screen options={{ title: scheduleName(schedule) }} />
			<ListGroup>
				<NextRow schedule={schedule} paused={paused} now={now} />
				<LastRow last={schedule.last} now={now} />
				<ListRow
					icon={FolderGit2}
					overline="Project"
					title={project?.name ?? entry.projectName}
				/>
			</ListGroup>
			<ScheduleNudges
				projectId={projectId}
				schedule={schedule}
				paused={paused}
				now={now}
			/>
		</Screen>
	);
}

/** When it starts next: a time, "Paused tonight" and the start after it, or why not. */
function NextRow({
	schedule,
	paused,
	now,
}: {
	schedule: ScheduleSummary;
	paused: boolean;
	now: number;
}) {
	const next = nextText(schedule, now);
	if (paused) {
		return (
			<ListRow
				look={PAUSED_TONIGHT}
				overline="Next start"
				title="Paused tonight"
				caption={
					schedule.nextAt !== null
						? `Starts again ${startText(schedule.nextAt, now)}`
						: undefined
				}
			/>
		);
	}
	return <ListRow icon={CalendarClock} overline="Next start" title={next} />;
}

/** How the last start went. A start that ran a run opens it. */
function LastRow({ last, now }: { last: ScheduleResult | null; now: number }) {
	const look = lastLook(last);
	if (!last || !look) {
		return (
			<ListRow
				icon={CalendarClock}
				overline="Last start"
				title="Never started"
			/>
		);
	}
	const runId = last.kind === "failed" ? null : last.runId;
	return (
		<ListRow
			look={look}
			overline="Last start"
			title={look.label}
			caption={startText(last.at, now)}
			detail={
				last.kind === "failed"
					? last.error
					: last.kind === "skipped"
						? last.reason
						: undefined
			}
			onPress={runId ? () => openFromSheet(runId) : undefined}
			accessibilityHint={runId ? "Opens the run" : undefined}
		/>
	);
}

/** Closes this sheet, then opens the run on the main screens. */
function openFromSheet(runId: string) {
	if (router.canDismiss()) router.dismiss();
	openRun(runId);
}
