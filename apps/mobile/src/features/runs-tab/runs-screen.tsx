import { groupStatuses } from "@nightshift/client";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Platform } from "react-native";

import { useSignedIn } from "@/features/host";
import { useTonight } from "@/features/schedules";
import { useSpaceMenu } from "@/features/spaces";
import { useClock } from "@/shared/clock";
import { TabRootHeader } from "@/shared/header";
import { NativeList, NativeSection, NativeTextRow } from "@/shared/native-list";
import { useScreenRefresh, useWhileFocused } from "@/shared/refresh";
import {
	type Gesture,
	nowHint,
	nowLines,
	tonightHint,
	tonightLines,
} from "./agenda";
import { problemRows } from "./agenda-line";
import { RunLine } from "./run-line";
import { ScheduleLine } from "./schedule-line";

/** The statuses of a run on its way: running or asleep. */
const ON_ITS_WAY = groupStatuses("running");

/** At most this many runs on their way show. */
const LIMIT = 30;

/** iOS swipes a row for its actions, Android holds it for a menu. */
const GESTURE: Gesture = Platform.OS === "android" ? "hold" : "swipe";

/**
 * Runs on the phone, as one native grouped list from now to tomorrow
 * morning, in the Space you chose in the header menu. Now: the runs on
 * their way, each with Stop. Tonight: the schedules of the next 24 hours,
 * each with Pause tonight or Undo pause, and Run now. Pull to refresh
 * reads both again. The phone shows no history and no numbers: that is
 * the work of the computer.
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
	const spaceMenu = useSpaceMenu();

	const runs = useMemo(
		() => nowLines(running.data ?? [], now),
		[running.data, now],
	);
	const schedules = useMemo(
		() => tonightLines(tonight.entries, now),
		[tonight.entries, now],
	);

	return (
		<>
			<TabRootHeader name={person.name} right={spaceMenu ? [spaceMenu] : []} />
			<NativeList onRefresh={refresh}>
				<NativeSection
					title="Now"
					footer={nowHint(runs.length, LIMIT, GESTURE)}
				>
					{running.isPending ? (
						<NativeTextRow text="Loading…" secondary />
					) : running.isError && running.data === undefined ? (
						problemRows({
							title: "The runs did not load",
							message: running.error.message,
							onRetry: () => void running.refetch(),
						})
					) : runs.length > 0 ? (
						runs.map((line) => <RunLine key={line.key} line={line} />)
					) : (
						<NativeTextRow text="Nothing runs right now" secondary />
					)}
				</NativeSection>

				<NativeSection title="Tonight" footer={tonightHint(schedules, GESTURE)}>
					{schedules.length > 0 ? (
						schedules.map((line) => <ScheduleLine key={line.key} line={line} />)
					) : tonight.error ? (
						problemRows({
							title: "The schedules did not load",
							message: tonight.error.message,
							onRetry: () => void tonight.refetch(),
						})
					) : tonight.loading ? (
						<NativeTextRow text="Loading…" secondary />
					) : (
						<NativeTextRow
							text={
								tonight.any
									? "Nothing runs tonight"
									: "No schedules yet. Add one on your computer."
							}
							secondary
						/>
					)}
				</NativeSection>
			</NativeList>
		</>
	);
}
