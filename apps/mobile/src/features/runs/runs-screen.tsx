import {
	createProjectQueries,
	createRunQueries,
	groupRuns,
	type RunGroup,
	type RunSummary,
} from "@nightshift/client";
import { Button } from "@nightshift/ui-native/components/ui/button";
import { Skeleton } from "@nightshift/ui-native/components/ui/skeleton";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { History } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { RefreshControl, SectionList, View } from "react-native";

import { useHostQueries } from "@/features/host";
import { SpacePicker } from "@/features/spaces";
import { Chip, ChipRail } from "@/shared/chips";
import { EmptyState } from "@/shared/empty";
import { ErrorAlert } from "@/shared/feedback";
import { LargeTitleHeader } from "@/shared/header";
import { Screen } from "@/shared/page";
import { usePullRefresh } from "@/shared/refresh";
import { RunRow } from "./run-row";

const GROUP_TITLE: Record<RunGroup, string> = {
	running: "Running",
	waiting: "Waiting for you",
	ended: "Ended",
};

/** The chips over the list: every run, or one group. */
const FILTERS: { key: RunGroup | "all"; label: string }[] = [
	{ key: "all", label: "All" },
	{ key: "running", label: "Running" },
	{ key: "waiting", label: "Waiting for you" },
	{ key: "ended", label: "Ended" },
];

function RunsHeader() {
	return <LargeTitleHeader title="Runs" actions={<SpacePicker />} />;
}

/** The runs of the Space you chose in the header: running, waiting for you, ended. Newest first. */
export function RunsScreen() {
	const [filter, setFilter] = useState<RunGroup | "all">("all");
	const runQueries = useHostQueries(createRunQueries);
	const projectQueries = useHostQueries(createProjectQueries);
	const runs = useQuery(runQueries.everyRunLive());
	const projects = useQuery(projectQueries.list());
	const refetch = useCallback(
		() => Promise.all([runs.refetch(), projects.refetch()]),
		[runs.refetch, projects.refetch],
	);
	const pull = usePullRefresh(refetch);

	const projectNames = useMemo(
		() => new Map((projects.data ?? []).map((p) => [p.id, p.name])),
		[projects.data],
	);
	const groups = useMemo(() => groupRuns(runs.data ?? []), [runs.data]);
	const counts = new Map<RunGroup | "all", number>([
		["all", runs.data?.length ?? 0],
		...groups.map(({ group, runs: data }) => [group, data.length] as const),
	]);
	// A group that empties (its last run ended) falls back to every run.
	const shown = counts.has(filter) ? filter : "all";
	const sections = useMemo(
		() =>
			groups
				.filter(({ group }) => shown === "all" || group === shown)
				.map(({ group, runs: data }) => ({ title: GROUP_TITLE[group], data })),
		[groups, shown],
	);
	// The list renders again on each poll; that is often enough for "12 min ago".
	const now = runs.dataUpdatedAt || Date.now();

	if (runs.isPending) {
		return (
			<Screen>
				<RunsHeader />
				<Skeleton className="h-4 w-24" />
				<Skeleton className="h-24 w-full rounded-xl" />
				<Skeleton className="h-24 w-full rounded-xl" />
				<Skeleton className="h-24 w-full rounded-xl" />
			</Screen>
		);
	}

	// A failed poll keeps the list it has.
	if (runs.isError && runs.data === undefined) {
		return (
			<Screen>
				<RunsHeader />
				<ErrorAlert
					title="The runs did not load"
					message={runs.error.message}
					fix="Check that this phone is online, then try again."
					onRetry={() => void runs.refetch()}
				/>
			</Screen>
		);
	}

	return (
		<SectionList<RunSummary, { title: string }>
			className="flex-1 bg-background"
			contentContainerClassName="flex-grow gap-3 p-4"
			contentInsetAdjustmentBehavior="automatic"
			sections={sections}
			keyExtractor={(run) => run.id}
			stickySectionHeadersEnabled={false}
			refreshControl={<RefreshControl {...pull} />}
			ListHeaderComponent={
				<View className="gap-4">
					<RunsHeader />
					{runs.data && runs.data.length > 0 ? (
						<ChipRail>
							{FILTERS.filter(({ key }) => counts.has(key)).map(
								({ key, label }) => (
									<Chip
										key={key}
										label={label}
										count={counts.get(key)}
										selected={shown === key}
										onPress={() => setFilter(key)}
									/>
								),
							)}
						</ChipRail>
					) : null}
				</View>
			}
			renderSectionHeader={({ section }) => (
				<Text variant="small" className="pt-2 text-muted-foreground">
					{section.title}
				</Text>
			)}
			renderItem={({ item }) => (
				<RunRow
					run={item}
					projectName={projectNames.get(item.projectId) ?? null}
					now={now}
				/>
			)}
			ListEmptyComponent={
				<View className="flex-1">
					<EmptyState
						icon={History}
						title="No runs yet"
						description="The runs of this Space show up here, newest first. Start a flow to make the first one."
					>
						<Button onPress={() => router.push("/start")}>
							<Text>Start a flow</Text>
						</Button>
					</EmptyState>
				</View>
			}
		/>
	);
}
