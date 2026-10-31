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
import { type Href, router, useLocalSearchParams } from "expo-router";
import { Folder, History, Search } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { View } from "react-native";

import { useHostQueries, useSignedIn } from "@/features/host";
import { SpacePicker } from "@/features/spaces";
import { Chip, ChipRail } from "@/shared/chips";
import { useClock } from "@/shared/clock";
import { EmptyState } from "@/shared/empty";
import { ErrorAlert } from "@/shared/feedback";
import { HeaderSearch, TabRootHeader } from "@/shared/header";
import {
	CellSeparator,
	cellsOf,
	ListCell,
	ListGroup,
	ListRow,
	SectionHead,
} from "@/shared/list";
import { ScreenList } from "@/shared/page";
import { useScreenRefresh, useWhileFocused } from "@/shared/refresh";
import { RunRow } from "./run-row";
import {
	byNight,
	countedFilters,
	filterCounts,
	filterStatuses,
	RUN_FILTERS,
	RUNS_PAGE,
	type RunFilter,
	runFilterOf,
	shownRuns,
} from "./runs-list";

/** One item of the list: the heading of a night, or a run in that night's card. */
type Item =
	| { kind: "night"; label: string; count: number }
	| { kind: "run"; item: RunSummary; first: boolean; last: boolean };

/**
 * The status and project of the list, kept in the link: `/runs?filter=failed`
 * shows the failed runs, `/runs?project=<id>` the runs of one project.
 */
function useRunsParams(): {
	filter: RunFilter;
	projectId: string | null;
	setFilter: (filter: RunFilter) => void;
	setProject: (projectId: string | null) => void;
	clear: () => void;
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
		setProject: (id) => router.setParams({ project: id ?? undefined }),
		clear: () => router.setParams({ filter: undefined, project: undefined }),
	};
}

function projectHref(projectId: string): Href {
	return { pathname: "/projects/[projectId]", params: { projectId } };
}

/**
 * The runs of the Space you chose in the header, newest first and grouped
 * by night. Search them by title, flow or project, and pick a status or a
 * project with the chips. Pull down, or come back to the tab, to read them
 * again. The next page reads as you scroll near the end.
 */
export function RunsScreen() {
	const { person } = useSignedIn();
	const { filter, projectId, setFilter, setProject, clear } = useRunsParams();
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
	const [query, setQuery] = useState("");
	const searching = query.trim() !== "";
	// The night headings change at noon.
	const now = useClock(60_000);

	const projectNames = useMemo(
		() => new Map((projects.data ?? []).map((p) => [p.id, p.name])),
		[projects.data],
	);
	const loaded = useMemo(() => runs.data?.pages.flat(), [runs.data]);
	const shown = useMemo(
		() =>
			shownRuns(loaded ?? [], {
				projectId,
				filter,
				query,
				projectName: (id) => projectNames.get(id),
			}),
		[loaded, projectId, filter, query, projectNames],
	);
	const counts = useMemo(
		() =>
			countedFilters(projects.data, projectId) ??
			filterCounts(
				shownRuns(loaded ?? [], {
					projectId,
					filter: "all",
					query: "",
					projectName: () => undefined,
				}),
			),
		[projects.data, projectId, loaded],
	);
	const items = useMemo(
		() =>
			byNight(shown, now).flatMap((night): Item[] => [
				{ kind: "night", label: night.label, count: night.runs.length },
				...cellsOf(night.runs).map((cell) => ({
					kind: "run" as const,
					...cell,
				})),
			]),
		[shown, now],
	);
	const projectName = projectId
		? (projectNames.get(projectId) ?? "This project")
		: null;

	const renderItem = useCallback(
		({ item }: ListRenderItemInfo<Item>) =>
			item.kind === "night" ? (
				<View className="pt-4 pb-3">
					<SectionHead
						title={item.label}
						hint={item.count === 1 ? "1 run" : `${item.count} runs`}
					/>
				</View>
			) : (
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
		!runs.isPending &&
		!(runs.isError && runs.data === undefined) &&
		!(projects.data !== undefined && spaceRuns === 0);

	// A search finds only the runs read so far: read on until one matches.
	useEffect(() => {
		if (listed && shown.length === 0) readMore();
	}, [listed, shown.length, readMore]);

	// Every state keeps the same list as the root of the screen: the large
	// title collapses with it.
	return (
		<ScreenList
			data={listed ? items : []}
			renderItem={renderItem}
			keyExtractor={itemKey}
			getItemType={itemType}
			ItemSeparatorComponent={CellSeparator}
			onEndReached={listed ? readMore : undefined}
			onEndReachedThreshold={1}
			ListFooterComponent={
				listed && isFetchingNextPage ? (
					<Skeleton className="mt-4 h-14 w-full rounded-xl" />
				) : null
			}
			onRefresh={runs.isPending ? undefined : refresh}
			header={
				<>
					<TabRootHeader
						name={person.name}
						right={[{ kind: "view", key: "space", element: <SpacePicker /> }]}
					/>
					<HeaderSearch placeholder="Search runs" onChange={setQuery} />
					{runs.isPending ? (
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
							<View className="gap-2">
								<ChipRail>
									{RUN_FILTERS.map(({ key, label }) => (
										<Chip
											key={key}
											label={label}
											count={searching ? undefined : counts[key]}
											selected={filter === key}
											onPress={() => setFilter(key)}
										/>
									))}
								</ChipRail>
								{projects.data && projects.data.length > 1 ? (
									<ChipRail>
										<Chip
											label="All projects"
											selected={projectId === null}
											onPress={() => setProject(null)}
										/>
										{projects.data.map((project) => (
											<Chip
												key={project.id}
												label={project.name}
												selected={projectId === project.id}
												onPress={() => setProject(project.id)}
											/>
										))}
									</ChipRail>
								) : null}
							</View>
							{projectId && projectName ? (
								<ListGroup>
									<ListRow
										icon={Folder}
										title={projectName}
										caption="See what needs you there and the last 7 nights"
										href={projectHref(projectId)}
										accessibilityHint="Opens the project"
									/>
								</ListGroup>
							) : null}
							{shown.length > 0 ? null : hasNextPage ? (
								<Skeleton className="h-14 w-full rounded-xl" />
							) : (
								<EmptyState
									icon={Search}
									title="No runs match"
									description="Try another word, or show every status and project."
								>
									<Button
										size="lg"
										variant="outline"
										onPress={clear}
										className="h-auto min-h-11 py-2"
									>
										<Text>Clear the filters</Text>
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

function itemKey(item: Item): string {
	return item.kind === "night" ? `night:${item.label}` : item.item.id;
}

function itemType(item: Item): Item["kind"] {
	return item.kind;
}
