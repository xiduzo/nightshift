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
import { useCallback, useMemo } from "react";
import { RefreshControl, SectionList, View } from "react-native";

import { useHostQueries } from "@/features/host";
import { EmptyState } from "@/shared/empty";
import { ErrorAlert } from "@/shared/feedback";
import { Screen } from "@/shared/page";
import { usePullRefresh } from "@/shared/refresh";
import { RunRow } from "./run-row";

const GROUP_TITLE: Record<RunGroup, string> = {
	running: "Running",
	waiting: "Waiting for you",
	ended: "Ended",
};

/** The runs of the Space you chose in the header: running, waiting for you, ended. Newest first. */
export function RunsScreen() {
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
	const sections = useMemo(
		() =>
			groupRuns(runs.data ?? []).map(({ group, runs: data }) => ({
				title: GROUP_TITLE[group],
				data,
			})),
		[runs.data],
	);
	// The list renders again on each poll; that is often enough for "12 min ago".
	const now = runs.dataUpdatedAt || Date.now();

	if (runs.isPending) {
		return (
			<Screen>
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
						<Button onPress={() => router.navigate("/start")}>
							<Text>Start a flow</Text>
						</Button>
					</EmptyState>
				</View>
			}
		/>
	);
}
