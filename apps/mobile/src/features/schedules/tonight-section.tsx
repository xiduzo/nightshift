import { hoverTime, scheduleName, scheduleNudges } from "@nightshift/client";
import { Button } from "@nightshift/ui-native/components/ui/button";
import { Icon } from "@nightshift/ui-native/components/ui/icon";
import { Skeleton } from "@nightshift/ui-native/components/ui/skeleton";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { Link } from "expo-router";
import {
	CalendarClock,
	ChevronRight,
	Moon,
	RotateCcw,
	TriangleAlert,
} from "lucide-react-native";
import { memo, type ReactNode } from "react";
import { View } from "react-native";

import { ErrorAlert } from "@/shared/feedback";
import { formatTime } from "@/shared/format";
import { ListGroup, ListRow, SectionHead } from "@/shared/list";
import type { Look } from "@/shared/tone";
import { RunNowButton } from "./run-now-button";
import { type OfflineNotice, type TonightEntry, tonightHint } from "./tonight";
import { useScheduleNudges } from "./use-nudges";
import type { Tonight } from "./use-tonight";

const PAUSED: Look = {
	tone: "stopped",
	icon: "moon",
	label: "Paused for tonight",
};

/**
 * Tonight on Watch: the schedules of the next 24 hours, each with its
 * flow, project, time and computer, and Pause tonight and Run now in the
 * row. A paused one shows Undo pause, one whose run is on its way opens
 * that run. Editing a schedule stays on the computer.
 */
export function TonightSection({
	tonight,
	now,
}: {
	tonight: Tonight;
	now: number;
}) {
	const { entries } = tonight;
	return (
		<View className="mt-4 gap-3">
			<SectionHead
				title="Tonight"
				hint={entries.length > 0 ? tonightHint(entries) : undefined}
			/>
			{entries.length > 0 ? (
				<ListGroup>
					{entries.map((entry) => (
						<TonightRow key={entry.key} entry={entry} now={now} />
					))}
				</ListGroup>
			) : tonight.error ? (
				<ErrorAlert
					title="The schedules did not load"
					message={tonight.error.message}
					fix="Check that this phone is online, then try again."
					onRetry={() => void tonight.refetch()}
				/>
			) : tonight.loading ? (
				<Skeleton className="h-24 w-full rounded-xl" />
			) : (
				<ListGroup>
					<ListRow
						icon={Moon}
						title={tonight.any ? "No start tonight" : "No schedules yet"}
						caption={
							tonight.any
								? "Your schedules start on other days."
								: "Add a schedule on your computer. It shows here."
						}
					/>
				</ListGroup>
			)}
		</View>
	);
}

/** The status under the title: paused, started, or its computer offline. */
function statusOf(entry: TonightEntry): Look | undefined {
	if (entry.paused) return PAUSED;
	if (entry.started) {
		return {
			tone: "running",
			icon: "loader",
			label: `Started at ${formatTime(entry.started.at)}`,
		};
	}
	if (entry.offline) {
		return {
			tone: "interrupted",
			icon: "circle-alert",
			label: `${entry.computer} is offline`,
		};
	}
	return undefined;
}

/** "03:00 on MacBook Pro": when and where it runs. */
function whereLine(entry: TonightEntry): string | undefined {
	const at = entry.schedule.nextAt;
	const time = entry.paused || at === null ? null : formatTime(at);
	const on = entry.computer ? `on ${entry.computer}` : null;
	if (time && on) return `${time} ${on}`;
	return time ?? on ?? undefined;
}

const TonightRow = memo(function TonightRow({
	entry,
	now,
}: {
	entry: TonightEntry;
	now: number;
}) {
	const { schedule } = entry;
	const nudges = useScheduleNudges(entry.projectId, schedule);
	const allowed = scheduleNudges(schedule, now);
	const name = scheduleName(schedule);
	const where = whereLine(entry);
	const at = entry.started?.at ?? (entry.paused ? null : schedule.nextAt);
	const hint =
		at === null
			? undefined
			: hoverTime(at, {
					zone: schedule.timeZone,
					device: schedule.device ?? entry.computer,
				});

	let actions: ReactNode = null;
	if (nudges.hidden) actions = null;
	else if (entry.paused) {
		actions = (
			<Button
				size="lg"
				variant="ghost"
				disabled={nudges.resuming}
				className="h-auto min-h-11 py-2"
				accessibilityHint="Starts it at its next time again"
				onPress={nudges.resume}
			>
				<Icon as={RotateCcw} />
				<Text>Undo pause</Text>
			</Button>
		);
	} else if (entry.started) {
		actions = (
			<Link
				href={{
					pathname: "/runs/[runId]",
					params: { runId: entry.started.runId },
				}}
				asChild
			>
				<Button size="lg" variant="ghost" className="h-auto min-h-11 py-2">
					<Text>Open the run</Text>
					<Icon as={ChevronRight} />
				</Button>
			</Link>
		);
	} else if (allowed.pause || allowed.runNow) {
		actions = (
			<>
				{allowed.pause ? (
					<Button
						size="lg"
						variant="secondary"
						disabled={nudges.pausing}
						className="h-auto min-h-11 py-2"
						accessibilityHint="Skips its starts until tomorrow morning"
						onPress={nudges.pause}
					>
						<Icon as={Moon} />
						<Text>Pause tonight</Text>
					</Button>
				) : null}
				{allowed.runNow ? (
					<RunNowButton
						name={name}
						busy={nudges.starting}
						disabled={entry.offline}
						onConfirm={nudges.runNow}
					/>
				) : null}
			</>
		);
	}

	return (
		<View>
			<ListRow
				icon={entry.offline && !entry.paused ? TriangleAlert : CalendarClock}
				tone={entry.offline && !entry.paused ? "interrupted" : undefined}
				title={name}
				status={statusOf(entry)}
				caption={[entry.projectName, ...(where ? [where] : [])]}
				accessibilityHint={hint}
			/>
			{actions ? (
				<View className="flex-row flex-wrap gap-2 px-4 pb-3">{actions}</View>
			) : null}
			{nudges.copy ? (
				<View className="px-4 pb-4">
					<ErrorAlert
						title={nudges.copy.title}
						message={nudges.copy.message}
						fix={nudges.copy.fix}
					/>
				</View>
			) : null}
		</View>
	);
});

/**
 * The notices at the top of Watch: a computer a schedule needs tonight is
 * offline. A tap opens Computers.
 */
export function OfflineNotices({ tonight }: { tonight: Tonight }) {
	if (tonight.notices.length === 0) return null;
	return (
		<ListGroup>
			{tonight.notices.map((notice) => (
				<ListRow
					key={notice.key}
					icon={TriangleAlert}
					tone="interrupted"
					title={notice.title}
					caption={notice.caption}
					href="/computers"
					accessibilityHint={
						notice.entry.schedule.nextAt === null
							? "Opens your computers"
							: `${hoverTime(notice.entry.schedule.nextAt, {
									zone: notice.entry.schedule.timeZone,
									device: notice.entry.computer,
								})}. Opens your computers`
					}
				/>
			))}
		</ListGroup>
	);
}

/**
 * On Computers: each schedule that needs an offline computer tonight, and
 * Pause tonight for it. Nothing when every computer tonight needs is on.
 */
export function OfflineHelp({ tonight }: { tonight: Tonight }) {
	if (tonight.notices.length === 0) return null;
	return (
		<View className="gap-4">
			{tonight.notices.map((notice) => (
				<PauseForComputer key={notice.key} notice={notice} />
			))}
		</View>
	);
}

function PauseForComputer({ notice }: { notice: OfflineNotice }) {
	const { entry } = notice;
	const nudges = useScheduleNudges(entry.projectId, entry.schedule);
	return (
		<View className="gap-3">
			<Text className="text-muted-foreground text-sm">
				{`${notice.sentence} Turn it on before then, or pause the flow for tonight.`}
			</Text>
			{nudges.hidden ? null : (
				<Button
					size="lg"
					variant="secondary"
					disabled={nudges.pausing}
					className="h-auto min-h-11 py-2"
					onPress={nudges.pause}
				>
					<Icon as={Moon} />
					<Text>{`Pause ${scheduleName(entry.schedule)} tonight`}</Text>
				</Button>
			)}
			{nudges.copy ? (
				<ErrorAlert
					title={nudges.copy.title}
					message={nudges.copy.message}
					fix={nudges.copy.fix}
				/>
			) : null}
		</View>
	);
}
