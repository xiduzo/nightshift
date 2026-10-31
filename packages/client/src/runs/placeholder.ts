import { FLOW_VERSION } from "@nightshift/flows";
import type { QueryClient } from "@tanstack/react-query";

import type { ApiQueryUtils } from "../api";
import type { RunDetail, RunSummary } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRun(value: unknown, runId: string): value is RunSummary {
	return isRecord(value) && value.id === runId && "projectId" in value;
}

/**
 * The run in what one list query holds: a list of runs, the pages of a
 * list, or the dashboard's runs of last night (full summaries, with their
 * group). The dashboard's open rows are not full runs, so they do not count.
 */
function runIn(data: unknown, runId: string): RunSummary | undefined {
	const lists: unknown[][] = [];
	if (Array.isArray(data)) lists.push(data);
	else if (isRecord(data)) {
		if (Array.isArray(data.pages)) {
			for (const page of data.pages) if (Array.isArray(page)) lists.push(page);
		}
		const lastNight = data.lastNight;
		if (isRecord(lastNight) && Array.isArray(lastNight.latest)) {
			lists.push(lastNight.latest);
		}
	}
	for (const list of lists) {
		const found = list.find((item) => isRun(item, runId));
		if (found) {
			const { group: _group, ...run } = found as RunSummary & {
				group?: string;
			};
			return run;
		}
	}
	return undefined;
}

/**
 * The run as a list in the cache has it: any list of runs (its pages
 * too) or the dashboard. The newest read wins, so the status is the one
 * last seen.
 */
export function cachedRunSummary(
	queryClient: QueryClient,
	orpc: ApiQueryUtils,
	runId: string,
): RunSummary | undefined {
	const cache = queryClient.getQueryCache();
	const queries = [
		...cache.findAll({ queryKey: orpc.runs.list.key() }),
		...cache.findAll({ queryKey: orpc.dashboard.summary.key() }),
	].sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt);
	for (const query of queries) {
		const run = runIn(query.state.data, runId);
		if (run) return run;
	}
	return undefined;
}

/**
 * The detail of a run as far as its summary tells: its title, status and
 * project, and no flow or steps yet. Only to show while the detail loads
 * (`placeholderData`): a screen that sees `isPlaceholderData` shows the
 * steps as loading, not as none.
 */
export function runDetailOfSummary(run: RunSummary): RunDetail {
	return {
		...run,
		flow: {
			version: FLOW_VERSION,
			inputs: [],
			outputs: [],
			start: "",
			nodes: [],
			edges: [],
		},
		calledFlows: {},
		flowRevision: null,
		steps: [],
		traversals: {},
		calledTraversals: [],
		takeOverCommand: null,
		resumes: [],
		commands: [],
		handOffs: [],
		variables: [],
		leases: [],
		services: [],
	};
}

/** What a run screen shows at once from a list in the cache, or nothing. */
export function runPlaceholder(
	queryClient: QueryClient,
	orpc: ApiQueryUtils,
	runId: string,
): RunDetail | undefined {
	const run = cachedRunSummary(queryClient, orpc, runId);
	return run ? runDetailOfSummary(run) : undefined;
}
