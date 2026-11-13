import { groupStatuses } from "@nightshift/client";
import { Skeleton } from "@nightshift/ui-native/components/ui/skeleton";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { cn } from "@nightshift/ui-native/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { View } from "react-native";

import { useSignedIn } from "@/features/host";
import { useTonight } from "@/features/schedules";
import { SpacePicker } from "@/features/spaces";
import { useClock } from "@/shared/clock";
import { ErrorAlert } from "@/shared/feedback";
import { TabRootHeader } from "@/shared/header";
import { Screen } from "@/shared/page";
import { useScreenRefresh, useWhileFocused } from "@/shared/refresh";
import { nowLines, tonightLines } from "./agenda";
import { RunLine } from "./run-line";
import { ScheduleLine } from "./schedule-line";

/** The statuses of a run on its way: running or asleep. */
const ON_ITS_WAY = groupStatuses("running");

/** At most this many runs on their way show. */
const LIMIT = 30;

/**
 * Runs on the phone, as one agenda from now to tomorrow morning, in the
 * Space you chose in the header. Now: the runs on their way, each with
 * Stop. Tonight: the schedules of the next 24 hours, each with Pause or
 * Undo, and Run now on a long press. The phone shows no history and no
 * numbers: that is the work of the computer.
 */
export function RunsScreen() {
	const { person, host } = useSignedIn();
	const { subscribed } = useWhileFocused();
	const now = useClock(60_000);
	// Under `runs.list`: the live cache reads it again when a run starts or ends.
	const running = useQuery({
		...host.orpc.runs.list.queryOptions({
			input: { statuses: [...ON_ITS_WAY], limit: LIMIT },
		}),
		subscribed,
	});
	const tonight = useTonight(now);
	const refresh = useScreenRefresh([running.refetch, tonight.refetch]);

	const runs = useMemo(
		() => nowLines(running.data ?? [], now),
		[running.data, now],
	);
	const schedules = useMemo(
		() => tonightLines(tonight.entries, now),
		[tonight.entries, now],
	);

	return (
		<Screen onRefresh={refresh}>
			<TabRootHeader
				name={person.name}
				right={[{ kind: "view", key: "space", element: <SpacePicker /> }]}
			/>

			<View>
				<Heading title="Now" />
				{running.isPending ? (
					<Skeleton className="h-14 w-full rounded-xl" />
				) : running.isError && running.data === undefined ? (
					<ErrorAlert
						title="The runs did not load"
						message={running.error.message}
						fix="Check that this phone is online, then try again."
						onRetry={() => void running.refetch()}
					/>
				) : runs.length > 0 ? (
					runs.map((line) => <RunLine key={line.key} line={line} />)
				) : (
					<Quiet>Nothing runs right now</Quiet>
				)}
			</View>

			<View>
				<Heading title="Tonight" className="pt-4" />
				{schedules.length > 0 ? (
					<>
						{schedules.map((line) => (
							<ScheduleLine key={line.key} line={line} />
						))}
						{schedules.some((line) => line.runNow === "yes") ? (
							<Text className="pt-2 text-muted-foreground text-xs">
								Hold a schedule to run it now.
							</Text>
						) : null}
					</>
				) : tonight.error ? (
					<ErrorAlert
						title="The schedules did not load"
						message={tonight.error.message}
						fix="Check that this phone is online, then try again."
						onRetry={() => void tonight.refetch()}
					/>
				) : tonight.loading ? (
					<Skeleton className="h-14 w-full rounded-xl" />
				) : (
					<Quiet>
						{tonight.any
							? "Nothing runs tonight"
							: "No schedules yet. Add one on your computer."}
					</Quiet>
				)}
			</View>
		</Screen>
	);
}

/** "Now", "Tonight": a small label over a part of the agenda. */
function Heading({ title, className }: { title: string; className?: string }) {
	return (
		<Text
			accessibilityRole="header"
			className={cn(
				"pb-1 font-medium text-muted-foreground text-xs uppercase",
				className,
			)}
		>
			{title}
		</Text>
	);
}

/** One quiet line where a part of the agenda is empty. */
function Quiet({ children }: { children: string }) {
	return (
		<Text className="min-h-14 py-4 text-muted-foreground">{children}</Text>
	);
}
