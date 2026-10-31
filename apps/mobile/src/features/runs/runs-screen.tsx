import {
	createProjectQueries,
	createRunQueries,
	type RunSummary,
} from "@nightshift/client";
import { Button } from "@nightshift/ui-native/components/ui/button";
import { Skeleton } from "@nightshift/ui-native/components/ui/skeleton";
import { Text } from "@nightshift/ui-native/components/ui/text";
import type { ListRenderItemInfo } from "@shopify/flash-list";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { History, X } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";

import { useHostQueries } from "@/features/host";
import { SearchResults } from "@/features/search";
import { SpacePicker } from "@/features/spaces";
import { Chip, ChipRail } from "@/shared/chips";
import { EmptyState } from "@/shared/empty";
import { ErrorAlert } from "@/shared/feedback";
import { HeaderSearch, HeaderToolbar } from "@/shared/header";
import { type Cell, CellSeparator, cellsOf, ListCell } from "@/shared/list";
import { ScreenList } from "@/shared/page";
import { useScreenRefresh, useWhileFocused } from "@/shared/refresh";
import { RunRow } from "./run-row";
import {
	countedFilters,
	emptyFilterTitle,
	filterCounts,
	filterRuns,
	filterStatuses,
	ofProject,
	RUN_FILTERS,
	RUNS_PAGE,
	type RunFilter,
	runFilterOf,
	runsSummary,
} from "./runs-list";

/** The Space picker and the search field in the native header. */
function RunsHeader({ onSearch }: { onSearch: (query: string) => void }) {
	return (
		<>
			<HeaderToolbar
				placement="right"
				items={[{ kind: "view", key: "space", element: <SpacePicker /> }]}
			/>
			<HeaderSearch placeholder="Runs and Gates" onChange={onSearch} />
		</>
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
 * The next page reads as you scroll near the end.
 */
export function RunsScreen() {
	const { filter, projectId, setFilter, clearProject } = useRunsParams();
	const runQueries = useHostQueries(createRunQueries);
	const projectQueries = useHostQueries(createProjectQueries);
	const projects = useQuery({ ...projectQueries.list(), ...useWhileFocused() });
	const runs = useInfiniteQuery({
		...runQueries.pages(
			{
				...(projectId !== null ? { projectId } : {}),
				...(filter !== "all" ? { statuses: filterStatuses(filter) } : {}),
			},
			RUNS_PAGE,
		),
		...useWhileFocused(),
	});
	const refresh = useScreenRefresh([runs.refetch, projects.refetch]);

	const projectNames = useMemo(
		() => new Map((projects.data ?? []).map((p) => [p.id, p.name])),
		[projects.data],
	);
	const loaded = useMemo(() => runs.data?.pages.flat(), [runs.data]);
	// An older Host sends every run whatever the filter: the screen filters too.
	const inProject = useMemo(
		() => ofProject(loaded ?? [], projectId),
		[loaded, projectId],
	);
	const counts = useMemo(
		() => countedFilters(projects.data, projectId) ?? filterCounts(inProject),
		[projects.data, projectId, inProject],
	);
	const shown = useMemo(
		() => filterRuns(inProject, filter),
		[inProject, filter],
	);
	const projectName = projectId
		? (projectNames.get(projectId) ?? "This project")
		: null;
	const [query, setQuery] = useState("");
	const searching = query.trim() !== "";

	const cells = useMemo(() => cellsOf(shown), [shown]);
	const renderRun = useCallback(
		({ item }: ListRenderItemInfo<Cell<RunSummary>>) => (
			<ListCell first={item.first} last={item.last}>
				<RunRow
					run={item.item}
					projectName={projectNames.get(item.item.projectId) ?? null}
				/>
			</ListCell>
		),
		[projectNames],
	);
	const { hasNextPage, isFetchingNextPage, fetchNextPage } = runs;
	const readMore = useCallback(() => {
		if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
	}, [hasNextPage, isFetchingNextPage, fetchNextPage]);

	// An older Host sends no counts but every run.
	const spaceRuns =
		countedFilters(projects.data, null)?.all ?? loaded?.length ?? 0;
	const listed =
		!searching &&
		!runs.isPending &&
		!(runs.isError && runs.data === undefined) &&
		!(projects.data !== undefined && spaceRuns === 0);

	// Every state keeps the same list as the root of the screen: the large
	// title collapses with it, and search results swap in place of the rows.
	return (
		<ScreenList
			data={listed ? cells : []}
			renderItem={renderRun}
			keyExtractor={runKey}
			ItemSeparatorComponent={CellSeparator}
			onEndReached={listed ? readMore : undefined}
			onEndReachedThreshold={1}
			ListFooterComponent={
				listed && isFetchingNextPage ? (
					<Skeleton className="mt-4 h-14 w-full rounded-xl" />
				) : null
			}
			onRefresh={searching || runs.isPending ? undefined : refresh}
			summary={listed ? runsSummary(counts[filter], projectName) : undefined}
			header={
				<>
					<RunsHeader onSearch={setQuery} />
					{searching ? (
						<SearchResults query={query} />
					) : runs.isPending ? (
						<>
							<Skeleton className="h-11 w-full rounded-full" />
							<Skeleton className="h-72 w-full rounded-xl" />
						</>
					) : runs.isError && runs.data === undefined ? (
						// A failed read again keeps the list it has.
						<ErrorAlert
							title="The runs did not load"
							message={runs.error.message}
							fix="Check that this phone is online, then try again."
							onRetry={() => void runs.refetch()}
						/>
					) : !listed ? (
						<EmptyState
							icon={History}
							title="No runs yet"
							description="Start a flow to make the first run."
						>
							<Button
								size="lg"
								onPress={() => router.push("/start")}
								className="h-auto min-h-11 py-2"
							>
								<Text>New run</Text>
							</Button>
						</EmptyState>
					) : (
						<>
							<ChipRail>
								{projectName ? (
									<Chip
										label={projectName}
										icon={X}
										selected
										onPress={clearProject}
										role="button"
										accessibilityHint="Shows the runs of every project"
									/>
								) : null}
								{RUN_FILTERS.map(({ key, label }) => (
									<Chip
										key={key}
										label={label}
										count={counts[key]}
										selected={filter === key}
										onPress={() => setFilter(key)}
									/>
								))}
							</ChipRail>
							{shown.length > 0 ? null : filter === "all" ? (
								<EmptyState
									icon={History}
									title="No runs in this project"
									description="Show every project to see the other runs."
								>
									<Button
										size="lg"
										variant="outline"
										onPress={clearProject}
										className="h-auto min-h-11 py-2"
									>
										<Text>Show every project</Text>
									</Button>
								</EmptyState>
							) : (
								<EmptyState
									icon={History}
									title={emptyFilterTitle(filter)}
									description="Choose another filter, or show all runs."
								>
									<Button
										size="lg"
										variant="outline"
										onPress={() => setFilter("all")}
										className="h-auto min-h-11 py-2"
									>
										<Text>Show all runs</Text>
									</Button>
								</EmptyState>
							)}
						</>
					)}
				</>
			}
		/>
	);
}

function runKey(cell: Cell<RunSummary>): string {
	return cell.item.id;
}
