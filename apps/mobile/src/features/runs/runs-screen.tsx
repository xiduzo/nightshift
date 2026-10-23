import { createProjectQueries, createRunQueries } from "@nightshift/client";
import { Button } from "@nightshift/ui-native/components/ui/button";
import { Skeleton } from "@nightshift/ui-native/components/ui/skeleton";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { History, Search, X } from "lucide-react-native";
import { useMemo, useState } from "react";

import { useHostQueries } from "@/features/host";
import { SpacePicker } from "@/features/spaces";
import { Chip, ChipRail } from "@/shared/chips";
import { EmptyState } from "@/shared/empty";
import { ErrorAlert } from "@/shared/feedback";
import { HeaderButton, LargeTitleHeader } from "@/shared/header";
import { ListGroup } from "@/shared/list";
import { Screen } from "@/shared/page";
import { useScreenRefresh } from "@/shared/refresh";
import { RunRow } from "./run-row";
import {
	emptyFilterTitle,
	filterCounts,
	filterRuns,
	ofProject,
	RUN_FILTERS,
	RUNS_PAGE,
	type RunFilter,
	runFilterOf,
	runsSummary,
} from "./runs-list";

function RunsHeader({ summary }: { summary?: string }) {
	return (
		<LargeTitleHeader
			title="Runs"
			summary={summary}
			actions={
				<>
					<SpacePicker />
					<HeaderButton
						icon={Search}
						label="Search"
						hint="Finds a run or a Gate"
						href="/search"
					/>
				</>
			}
		/>
	);
}

/**
 * The filter and project of the list, kept in the link: `/runs?filter=failed`
 * shows the failed runs, `/runs?project=<id>` the runs of one project.
 */
function useRunsParams(): {
	filter: RunFilter;
	projectId: string | null;
	setFilter: (filter: RunFilter) => void;
	clearProject: () => void;
} {
	const params = useLocalSearchParams<{ filter?: string; project?: string }>();
	const projectId =
		typeof params.project === "string" && params.project !== ""
			? params.project
			: null;
	return {
		filter: runFilterOf(params.filter),
		projectId,
		setFilter: (filter) =>
			router.setParams({ filter: filter === "all" ? undefined : filter }),
		clearProject: () => router.setParams({ project: undefined }),
	};
}

/**
 * The runs of the Space you chose in the header, newest first. Chips show
 * the runs on their way, the runs that need you, the failed and the
 * finished ones. Pull down, or come back to the tab, to read them again.
 */
export function RunsScreen() {
	const { filter, projectId, setFilter, clearProject } = useRunsParams();
	const runQueries = useHostQueries(createRunQueries);
	const projectQueries = useHostQueries(createProjectQueries);
	const runs = useQuery(runQueries.everyRunLive());
	const projects = useQuery(projectQueries.list());
	const [limit, setLimit] = useState(RUNS_PAGE);
	const refresh = useScreenRefresh([runs.refetch, projects.refetch]);

	const projectNames = useMemo(
		() => new Map((projects.data ?? []).map((p) => [p.id, p.name])),
		[projects.data],
	);
	const inProject = useMemo(
		() => ofProject(runs.data ?? [], projectId),
		[runs.data, projectId],
	);
	const counts = useMemo(() => filterCounts(inProject), [inProject]);
	const shown = useMemo(
		() => filterRuns(inProject, filter),
		[inProject, filter],
	);
	const projectName = projectId
		? (projectNames.get(projectId) ?? "This project")
		: null;
	// The list renders again on each poll: often enough for "12 min".
	const now = runs.dataUpdatedAt || Date.now();

	const choose = (next: RunFilter) => {
		setLimit(RUNS_PAGE);
		setFilter(next);
	};

	if (runs.isPending) {
		return (
			<Screen>
				<RunsHeader />
				<Skeleton className="h-11 w-full rounded-full" />
				<Skeleton className="h-72 w-full rounded-xl" />
			</Screen>
		);
	}

	// A failed poll keeps the list it has.
	if (runs.isError && runs.data === undefined) {
		return (
			<Screen onRefresh={refresh}>
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

	if (runs.data.length === 0) {
		return (
			<Screen onRefresh={refresh}>
				<RunsHeader />
				<EmptyState
					icon={History}
					title="No runs yet"
					description="The runs of this Space show up here, newest first. Start a flow to make the first one."
				>
					<Button onPress={() => router.push("/start")}>
						<Text>New run</Text>
					</Button>
				</EmptyState>
			</Screen>
		);
	}

	return (
		<Screen onRefresh={refresh}>
			<RunsHeader summary={runsSummary(shown.length, projectName)} />
			<ChipRail>
				{projectName ? (
					<Chip
						label={projectName}
						icon={X}
						selected
						onPress={() => {
							setLimit(RUNS_PAGE);
							clearProject();
						}}
						accessibilityHint="Shows the runs of every project"
					/>
				) : null}
				{RUN_FILTERS.map(({ key, label }) => (
					<Chip
						key={key}
						label={label}
						count={counts[key]}
						selected={filter === key}
						onPress={() => choose(key)}
					/>
				))}
			</ChipRail>
			{shown.length > 0 ? (
				<>
					<ListGroup>
						{shown.slice(0, limit).map((run) => (
							<RunRow
								key={run.id}
								run={run}
								projectName={projectNames.get(run.projectId) ?? null}
								now={now}
							/>
						))}
					</ListGroup>
					{shown.length > limit ? (
						<Button
							variant="outline"
							className="self-center"
							onPress={() => setLimit((current) => current + RUNS_PAGE)}
						>
							<Text>Show more runs</Text>
						</Button>
					) : null}
				</>
			) : filter === "all" ? (
				<EmptyState
					icon={History}
					title="No runs in this project"
					description="The runs of this project show up here. Show every project to see the other runs."
				>
					<Button variant="outline" onPress={clearProject}>
						<Text>Show every project</Text>
					</Button>
				</EmptyState>
			) : (
				<EmptyState
					icon={History}
					title={emptyFilterTitle(filter)}
					description="Choose another filter, or show all runs."
				>
					<Button variant="outline" onPress={() => choose("all")}>
						<Text>Show all runs</Text>
					</Button>
				</EmptyState>
			)}
		</Screen>
	);
}
