import {
	createDashboardQueries,
	createProjectQueries,
	type DashboardSummary,
	hoverTime,
} from "@nightshift/client";
import { Skeleton } from "@nightshift/ui-native/components/ui/skeleton";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { useQuery } from "@tanstack/react-query";
import { type Href, router } from "expo-router";
import { CircleCheck, Moon, MoonStar } from "lucide-react-native";
import { type ReactNode, useMemo } from "react";
import { View } from "react-native";

import { useHostQueries, useSignedIn } from "@/features/host";
import { useNeedsYou } from "@/features/needs";
import {
	OfflineNotices,
	TonightSection,
	useTonight,
} from "@/features/schedules";
import { useClock } from "@/shared/clock";
import { ErrorAlert } from "@/shared/feedback";
import { formatTime } from "@/shared/format";
import { TabRootHeader } from "@/shared/header";
import { ListGroup, ListRow, SectionHead } from "@/shared/list";
import { Screen } from "@/shared/page";
import { useScreenRefresh, useWhileFocused } from "@/shared/refresh";
import {
	leadText,
	nightLine,
	nightNumbers,
	nightOutput,
	runningNow,
	todayLine,
} from "./last-night";
import { NightTiles } from "./night-tiles";
import { NeedsItemRow, NightRunRow } from "./watch-rows";

/** The Runs tab, showing only the runs on their way. */
const RUNNING_RUNS: Href = { pathname: "/runs", params: { filter: "running" } };

/** How many things of Needs you Watch shows. The rest wait on that tab. */
const NEEDS_SHOWN = 3;

/**
 * Watch: does something need you, how last night went, what runs now and
 * what runs tonight, over every Space you are in. In the header, the
 * avatar opens Settings and + starts a run.
 */
export function WatchScreen() {
	const { person } = useSignedIn();
	const { subscribed } = useWhileFocused();
	const now = useClock(60_000);
	const dashboard = useHostQueries(createDashboardQueries);
	const projectQueries = useHostQueries(createProjectQueries);
	const summary = useQuery({
		...dashboard.summary({ everySpace: true }),
		subscribed,
	});
	const projects = useQuery({ ...projectQueries.list(), subscribed });
	const needs = useNeedsYou(subscribed);
	const tonight = useTonight(now);
	const refresh = useScreenRefresh([
		summary.refetch,
		needs.refetch,
		tonight.refetch,
	]);

	const projectNames = useMemo(
		() =>
			new Map(
				(projects.data ?? []).map((project) => [project.id, project.name]),
			),
		[projects.data],
	);
	const data = summary.data;
	const numbers = data ? nightNumbers(data) : undefined;
	const leadGate = needs.items.find((item) => item.kind === "gate");
	const leadAt =
		leadGate?.kind === "gate" ? leadGate.gate.deadline?.at : undefined;

	return (
		<Screen
			onRefresh={refresh}
			summary={todayLine(now, formatTime)}
			summaryHint={hoverTime(now)}
		>
			<TabRootHeader name={person.name} />

			{needs.loading ? (
				<Skeleton className="h-16 w-full rounded-xl" />
			) : (
				<View className="gap-1">
					<Text
						className="font-semibold text-xl tracking-tight"
						accessibilityHint={leadAt ? hoverTime(leadAt) : undefined}
					>
						{leadText(needs.items, formatTime)}
					</Text>
					{numbers && data?.lastNight ? (
						<Text className="text-muted-foreground text-sm">
							{nightLine(numbers, data.lastNight.runs)}
						</Text>
					) : null}
				</View>
			)}

			<OfflineNotices tonight={tonight} />

			<Section>
				<SectionHead
					title="Needs you"
					seeAll={
						needs.items.length > 0
							? {
									label: `All ${needs.items.length}`,
									onPress: () => router.navigate("/needs"),
								}
							: undefined
					}
				/>
				{needs.gatesError && needs.items.length === 0 ? (
					<ErrorAlert
						title="Your Gates did not load"
						message={needs.gatesError.message}
						fix="Check that this phone is online, then try again."
						onRetry={() => void needs.refetch()}
					/>
				) : needs.loading ? (
					<Skeleton className="h-24 w-full rounded-xl" />
				) : needs.items.length > 0 ? (
					<ListGroup>
						{needs.items.slice(0, NEEDS_SHOWN).map((item) => (
							<NeedsItemRow
								key={item.key}
								item={item}
								projectName={(id) => projectNames.get(id)}
							/>
						))}
					</ListGroup>
				) : (
					<ListGroup>
						<ListRow
							icon={CircleCheck}
							tone="finished"
							title="Nothing needs you"
							caption="A Gate, a stopped run or a learning shows here."
						/>
					</ListGroup>
				)}
			</Section>

			{data ? (
				<>
					<LastNightSection data={data} now={now} />
					<RunningSection data={data} now={now} />
				</>
			) : summary.isError ? (
				<ErrorAlert
					title="Last night did not load"
					message={summary.error.message}
					fix="Check that this phone is online, then try again."
					onRetry={() => void summary.refetch()}
				/>
			) : (
				<Skeleton className="h-48 w-full rounded-xl" />
			)}

			<TonightSection tonight={tonight} now={now} />
		</Screen>
	);
}

/** A section of Watch: a little more room above it than between its parts. */
function Section({ children }: { children: ReactNode }) {
	return <View className="mt-4 gap-3">{children}</View>;
}

/** Last night: its numbers, and the runs that ended, at most four. */
function LastNightSection({
	data,
	now,
}: {
	data: DashboardSummary;
	now: number;
}) {
	const numbers = nightNumbers(data);
	const ended = nightOutput(data);
	return (
		<Section>
			<SectionHead
				title="Last night"
				seeAll={{ href: "/runs", label: "All runs" }}
			/>
			{numbers ? (
				<>
					<NightTiles numbers={numbers} />
					{ended.length > 0 ? (
						<ListGroup>
							{ended.map((run) => (
								<NightRunRow key={run.id} run={run} now={now} />
							))}
						</ListGroup>
					) : null}
				</>
			) : (
				<ListGroup>
					<ListRow
						icon={MoonStar}
						title="No runs yet"
						caption="Start a flow tonight. In the morning you see here how it went."
					/>
				</ListGroup>
			)}
		</Section>
	);
}

/** The runs at work now, running or waiting at a Gate. */
function RunningSection({
	data,
	now,
}: {
	data: DashboardSummary;
	now: number;
}) {
	const runs = runningNow(data);
	return (
		<Section>
			<SectionHead
				title="Running now"
				seeAll={
					runs.length > 0 || data.open.running > 0
						? { href: RUNNING_RUNS, label: "Runs" }
						: undefined
				}
			/>
			{runs.length > 0 ? (
				<ListGroup>
					{runs.map((run) => (
						<NightRunRow key={run.id} run={run} now={now} />
					))}
				</ListGroup>
			) : data.open.running > 0 ? (
				<ListGroup>
					<ListRow
						icon={Moon}
						title={
							data.open.running === 1
								? "1 run is at work"
								: `${data.open.running} runs are at work`
						}
						caption="See them on the Runs tab."
						href={RUNNING_RUNS}
					/>
				</ListGroup>
			) : (
				<ListGroup>
					<ListRow
						icon={Moon}
						title="Nothing runs right now"
						caption="Tap + to start a run."
					/>
				</ListGroup>
			)}
		</Section>
	);
}
