import type { ApiQueryUtils } from "../api";
import type { RunStatus, RunSummary } from "./types";

/**
 * How often a run's files are read again while it runs: an agent keeps a
 * file in the middle of a step, and no stream item says so.
 */
const ARTIFACTS_POLL_MS = 15_000;

/** Where the next page of a run list starts: after this run. */
export type RunCursor = Pick<RunSummary, "createdAt" | "id">;

/**
 * The cursor of the page after `page`, or none when it was the last. An
 * older Host sends every run whatever the input: a page longer than asked,
 * or one that does not start after its cursor, is the last.
 */
export function nextRunCursor(
	page: readonly RunCursor[],
	pageSize: number,
	cursor: RunCursor | undefined,
): RunCursor | undefined {
	if (page.length !== pageSize) return undefined;
	const first = page[0];
	if (
		cursor &&
		first &&
		(first.createdAt > cursor.createdAt ||
			(first.createdAt === cursor.createdAt && first.id >= cursor.id))
	) {
		return undefined;
	}
	const last = page.at(-1);
	return last ? { createdAt: last.createdAt, id: last.id } : undefined;
}

/**
 * The query options of runs. No list polls: the live cache follows the
 * Host, and a run that starts, sleeps, wakes, moves, stops or ends, or a
 * step that starts or ends, reads the runs again (`run-changed`). After a
 * drop of the stream it reads them again too.
 */
export function createRunQueries(orpc: ApiQueryUtils) {
	return {
		/** Every list of runs. The live cache reads them again after a run changes. */
		lists: () => orpc.runs.list.key(),
		/** The detail of one run, or of every run without `runId`: to read it again. */
		getKey: (runId?: string) =>
			orpc.runs.get.key(runId === undefined ? {} : { input: { runId } }),
		/** The opened steps of one run, or of every run without `runId`: to read them again. */
		stepKey: (runId?: string) =>
			orpc.runs.step.key(runId === undefined ? {} : { input: { runId } }),
		/** The files of one run, or of every run without `runId`: to read them again. */
		artifactsKey: (runId?: string) =>
			orpc.runs.artifacts.key(runId === undefined ? {} : { input: { runId } }),
		/** The runs of the Space, of every project. A failed read again keeps the list. */
		everyRun: () => ({
			...orpc.runs.list.queryOptions({ input: {} }),
			meta: { quietRefetchErrors: true },
		}),
		/** The sleeping runs of every project, for the inbox. A failed read does not toast. */
		sleeping: () => ({
			...orpc.runs.list.queryOptions({ input: { statuses: ["sleeping"] } }),
			meta: { quietErrors: true },
		}),
		/** The runs of one project, or its newest `limit`. A failed read again keeps the list. */
		ofProject: (projectId: string, limit?: number) => ({
			...orpc.runs.list.queryOptions({
				input: { projectId, ...(limit !== undefined ? { limit } : {}) },
			}),
			meta: { quietRefetchErrors: true },
		}),
		/** The newest runs of the Space, at most `limit`. A failed read again keeps them. */
		latest: (limit: number) => ({
			...orpc.runs.list.queryOptions({ input: { limit } }),
			meta: { quietRefetchErrors: true },
		}),
		/**
		 * The runs of the Space (of one project, with one of `statuses`),
		 * newest first, `pageSize` at a time: the next page loads when the
		 * screen asks for more.
		 */
		pages: (
			filter: { projectId?: string; statuses?: RunStatus[] },
			pageSize: number,
		) =>
			orpc.runs.list.infiniteOptions({
				input: (cursor: RunCursor | undefined) => ({
					...filter,
					limit: pageSize,
					...(cursor ? { cursor } : {}),
				}),
				initialPageParam: undefined as RunCursor | undefined,
				getNextPageParam: (page, _pages, cursor) =>
					nextRunCursor(page, pageSize, cursor),
				meta: { quietRefetchErrors: true },
			}),
		/** One run with its steps. */
		get: (runId: string) => orpc.runs.get.queryOptions({ input: { runId } }),
		/** One step with the prompt of each session and each item it ran: read when a person opens it. */
		step: (runId: string, stepId: string) =>
			orpc.runs.step.queryOptions({ input: { runId, stepId } }),
		/** The files a run's agents kept. Polls while the run runs, so a new one shows. */
		artifacts: (runId: string, live: boolean) => ({
			...orpc.runs.artifacts.queryOptions({ input: { runId } }),
			refetchInterval: live ? ARTIFACTS_POLL_MS : (false as const),
			meta: { quietRefetchErrors: true },
		}),
		/**
		 * The person's Devices for the project, online or not. With
		 * `forNode`, the Devices that node may name, as the Host decides.
		 */
		devices: (projectId: string, forNode?: { profile?: string }) =>
			orpc.runs.devices.queryOptions({
				input: { projectId, ...(forNode ? { forNode } : {}) },
			}),
		/** The person's own Devices the run can move to now, from the run's own Space ("Move to…"). */
		moveTargets: (runId: string) =>
			orpc.runs.moveTargets.queryOptions({ input: { runId } }),
		/** The person's Devices a run of the project can run on, this computer first. */
		placements: (projectId: string) =>
			orpc.runs.placements.queryOptions({ input: { projectId } }),
	};
}

/** The mutation options of runs. */
export function createRunMutations(orpc: ApiQueryUtils) {
	return {
		start: orpc.runs.start.mutationOptions,
		stop: orpc.runs.stop.mutationOptions,
		resume: orpc.runs.resume.mutationOptions,
		signal: orpc.runs.signal.mutationOptions,
		restartStep: orpc.runs.restartStep.mutationOptions,
		rerun: orpc.runs.rerun.mutationOptions,
		move: orpc.runs.move.mutationOptions,
	};
}
