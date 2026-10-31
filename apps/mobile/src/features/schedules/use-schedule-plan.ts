import {
	createProjectQueries,
	createScheduleQueries,
	type PlannedSchedule,
	schedulePlan,
} from "@nightshift/client";
import {
	type UseQueryResult,
	useMutationState,
	useQueries,
	useQuery,
} from "@tanstack/react-query";
import { useMemo } from "react";

import { useHostQueries, useSignedIn } from "@/features/host";
import { useWhileFocused } from "@/shared/refresh";

/** One schedule of one project, as a key: schedule ids are per project. */
export function scheduleKey(projectId: string, scheduleId: string): string {
	return `${projectId}:${scheduleId}`;
}

type ListResults = UseQueryResult<
	{ schedules: PlannedSchedule["schedule"][] },
	Error
>[];

/** What the lists say together. TanStack keeps the result when nothing in it changed. */
function combineLists(results: ListResults) {
	return {
		datas: results.map((result) => result.data?.schedules),
		pending: results.some((result) => result.isPending),
		error:
			results.length > 0 && results.every((result) => result.isError)
				? (results[0]?.error ?? null)
				: null,
		refetches: results.map((result) => result.refetch),
	};
}

/**
 * The schedules of the active Space by when they start (`schedulePlan`),
 * or of one project with `projectId`. One read of the projects, and one
 * read of the schedules of each project. While reads are on their way,
 * the plan holds what came back already.
 */
export function useSchedulePlan(projectId: string | undefined, now: number) {
	const projectQueries = useHostQueries(createProjectQueries);
	const scheduleQueries = useHostQueries(createScheduleQueries);
	const focused = useWhileFocused();
	const projects = useQuery({ ...projectQueries.list(), ...focused });
	const shown = useMemo(
		() =>
			projectId
				? projects.data?.filter((project) => project.id === projectId)
				: projects.data,
		[projects.data, projectId],
	);
	const lists = useQueries({
		queries: (shown ?? []).map((project) => ({
			...scheduleQueries.list(project.id),
			...focused,
		})),
		combine: combineLists,
	});

	const { datas } = lists;
	const entries = useMemo(() => {
		const all: PlannedSchedule[] = [];
		(shown ?? []).forEach((project, index) => {
			for (const schedule of datas[index] ?? []) {
				all.push({
					projectId: project.id,
					projectName: project.name,
					schedule,
				});
			}
		});
		return all;
	}, [shown, datas]);
	const plan = useMemo(() => schedulePlan(entries, now), [entries, now]);

	return {
		plan,
		entries,
		/** The project of `projectId`, once the projects are in. */
		project: projectId ? shown?.[0] : undefined,
		projectsLoaded: projects.data !== undefined,
		/** Nothing to show: the projects, or every list, did not load. */
		error: projects.error ?? lists.error,
		loading: projects.isPending || (lists.pending && entries.length === 0),
		refetch: () =>
			Promise.allSettled([
				projects.refetch(),
				...lists.refetches.map((refetch) => refetch()),
			]),
	};
}

/** The `scheduleId` of a nudge's input. */
function scheduleOf(variables: unknown): string | undefined {
	if (typeof variables !== "object" || variables === null) return undefined;
	const { projectId, scheduleId } = variables as Record<string, unknown>;
	return typeof projectId === "string" && typeof scheduleId === "string"
		? scheduleKey(projectId, scheduleId)
		: undefined;
}

/**
 * The schedules with a Pause tonight or a Resume tonight on its way, by
 * `scheduleKey`: a list shows the result before the Host answers.
 */
export function usePendingPauses(): ReadonlyMap<string, "pause" | "resume"> {
	const { host } = useSignedIn();
	const pausing = useMutationState({
		filters: {
			mutationKey: host.orpc.schedules.pauseTonight.mutationKey(),
			status: "pending",
		},
		select: (mutation) => scheduleOf(mutation.state.variables),
	});
	const resuming = useMutationState({
		filters: {
			mutationKey: host.orpc.schedules.resumeTonight.mutationKey(),
			status: "pending",
		},
		select: (mutation) => scheduleOf(mutation.state.variables),
	});
	return useMemo(() => {
		const pending = new Map<string, "pause" | "resume">();
		for (const key of pausing) if (key) pending.set(key, "pause");
		for (const key of resuming) if (key) pending.set(key, "resume");
		return pending;
	}, [pausing, resuming]);
}
