import { createProjectQueries, groupStatuses } from "@nightshift/client";
import { Skeleton } from "@nightshift/ui-native/components/ui/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Moon } from "lucide-react-native";
import { useMemo } from "react";
import { View } from "react-native";

import { useHostQueries, useSignedIn } from "@/features/host";
import { RunRow } from "@/features/runs";
import {
	OfflineNotices,
	TonightSection,
	useTonight,
} from "@/features/schedules";
import { SpacePicker } from "@/features/spaces";
import { useClock } from "@/shared/clock";
import { ErrorAlert } from "@/shared/feedback";
import { TabRootHeader } from "@/shared/header";
import { ListGroup, ListRow, SectionHead } from "@/shared/list";
import { Screen } from "@/shared/page";
import { useScreenRefresh, useWhileFocused } from "@/shared/refresh";

/** The statuses of a run on its way: running or asleep. */
const ON_ITS_WAY = groupStatuses("running");

/** At most this many runs on their way show. */
const LIMIT = 30;

/**
 * Runs on the phone: what runs now and what runs tonight, in the Space you
 * chose in the header. A run opens its screen, with Stop. A schedule has
 * Pause tonight and Run now. How the runs went, and every older run, is
 * the work of the computer: the phone shows no history and no numbers.
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
	const projectQueries = useHostQueries(createProjectQueries);
	const projects = useQuery({ ...projectQueries.list(), subscribed });
	const tonight = useTonight(now);
	const refresh = useScreenRefresh([
		running.refetch,
		projects.refetch,
		tonight.refetch,
	]);

	const projectNames = useMemo(
		() => new Map((projects.data ?? []).map((p) => [p.id, p.name])),
		[projects.data],
	);
	const runs = useMemo(
		() => [...(running.data ?? [])].sort((a, b) => b.createdAt - a.createdAt),
		[running.data],
	);

	return (
		<Screen onRefresh={refresh}>
			<TabRootHeader
				name={person.name}
				right={[{ kind: "view", key: "space", element: <SpacePicker /> }]}
			/>

			<OfflineNotices tonight={tonight} />

			<View className="gap-3">
				<SectionHead title="Running now" />
				{running.isPending ? (
					<Skeleton className="h-24 w-full rounded-xl" />
				) : running.isError && running.data === undefined ? (
					<ErrorAlert
						title="The runs did not load"
						message={running.error.message}
						fix="Check that this phone is online, then try again."
						onRetry={() => void running.refetch()}
					/>
				) : runs.length > 0 ? (
					<ListGroup>
						{runs.map((item) => (
							<RunRow
								key={item.id}
								run={item}
								projectName={projectNames.get(item.projectId) ?? null}
							/>
						))}
					</ListGroup>
				) : (
					<ListGroup>
						<ListRow
							icon={Moon}
							title="Nothing runs right now"
							caption="Run now on a schedule below starts one."
						/>
					</ListGroup>
				)}
			</View>

			<TonightSection tonight={tonight} now={now} />
		</Screen>
	);
}
