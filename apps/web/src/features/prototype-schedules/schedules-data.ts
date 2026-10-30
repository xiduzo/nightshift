/**
 * PROTOTYPE, throw away. Everything a Schedules page variant shows, joined
 * once: each schedule with its flow, the runs it started (newest first),
 * its next starts, and the computers it needs.
 */

import { nextCronTimes, nextTimeOfDay } from "@nightshift/flows";
import { useQuery } from "@tanstack/react-query";
import {
	type Machine,
	neededMachines,
	useSpaceMachines,
} from "@/features/devices";
import { flowQueries } from "@/features/flows";
import { runQueries } from "@/features/runs";
import { scheduleQueries } from "@/features/schedules";
import { settingsQueries } from "@/features/settings";
import type { RunSummary, ScheduleIssue, ScheduleSummary } from "@/shared/api";

export type ScheduleRow = {
	schedule: ScheduleSummary;
	name: string;
	/** The flow's description, when it has one. */
	description: string | null;
	/** The runs this schedule started, newest first. */
	runs: RunSummary[];
	/** The next starts within `HORIZON_MS`, when it is on and has a cron line. */
	upcoming: number[];
	/** When a run that starts at a time stops, from its `stopAt`. */
	stopsAfter: (start: number) => number | null;
	needs: Machine[];
	errors: string[];
};

export const DAY_MS = 24 * 60 * 60 * 1000;
export const HORIZON_MS = 7 * DAY_MS;

export function useScheduleRows(projectId: string, now: number) {
	const list = useQuery(scheduleQueries.listLive(projectId));
	const runs = useQuery(runQueries.ofProject(projectId, 200));
	const flows = useQuery(flowQueries.list(projectId));
	const settings = useQuery(settingsQueries.get());
	const machines = useSpaceMachines();
	const schedulerOff = settings.data ? !settings.data.values.scheduler : false;

	const rows: ScheduleRow[] | undefined = list.data?.schedules.map(
		(schedule) => {
			const flow = flows.data?.find((f) => f.name === schedule.flow);
			const own = (runs.data ?? []).filter(
				(run) =>
					run.trigger.kind !== "manual" &&
					run.trigger.scheduleId === schedule.id,
			);
			const upcoming =
				schedule.enabled && schedule.cron
					? nextCronTimes(schedule.cron, now, 400).filter(
							(at) => at < now + HORIZON_MS,
						)
					: [];
			return {
				schedule,
				name: schedule.flow ?? schedule.signal?.name ?? schedule.id,
				description: flow?.description ?? null,
				runs: own,
				upcoming,
				stopsAfter: (start) =>
					schedule.stopAt ? nextTimeOfDay(schedule.stopAt, start) : null,
				needs: machines
					? neededMachines(
							machines,
							schedule.device,
							schedule.flow === undefined
								? { names: [], ids: [] }
								: flow?.devices,
						)
					: [],
				errors: schedule.issues
					.filter((issue) => issue.severity === "error")
					.map((issue) => issue.message),
			};
		},
	);

	return {
		rows,
		listIssues: (list.data?.issues ?? []) as readonly ScheduleIssue[],
		error: list.error,
		loading: list.isLoading,
		schedulerOff,
		starter: machines?.starterIsHost ? machines.starter.name : null,
	};
}

/** How many of the runs that ended finished. */
export function finishedShare(runs: RunSummary[]) {
	const ended = runs.filter((run) => run.endedAt !== null);
	const finished = ended.filter((run) => run.status === "finished").length;
	return { ended: ended.length, finished };
}
