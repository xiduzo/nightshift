import { isTestRun } from "../../../run-status";
import { lastDays } from "./clock";
import type { NightRange, TopRows } from "./measure-types";
import type { RunIn } from "./runs";
import { toLatestReport, topRows } from "./stats";
import type { FlowReport } from "./summary-types";

/** A run with the start of its day and its group, worked out once. */
export type PlacedRun<Run extends RunIn = RunIn> = {
	run: Run;
	day: number;
	group: string;
};

/** The runs without the test runs (`isTestRun`). */
export function notTests<Run extends RunIn>(
	runs: readonly PlacedRun<Run>[],
): PlacedRun<Run>[] {
	return runs.filter(({ run }) => !isTestRun(run));
}

/**
 * The newest report of each flow whose runs in the range wrote one: one
 * row per flow, the newest end first. The runs are the runs of their own
 * that started in the range: a called flow's report counts in no row.
 */
export function reportsOf(
	range: NightRange,
	runs: readonly PlacedRun[],
	now: number,
	timeZone: string,
): TopRows<FlowReport> {
	const first = lastDays(range, now, timeZone)[0] ?? 0;
	const inRange = notTests(runs).filter(({ day }) => day >= first);
	const flows = new Map<string, FlowReport>();
	for (const { run, group } of inRange) {
		const report = toLatestReport(run);
		if (report === null) continue;
		const key = `${run.projectId}/${run.flowName ?? run.title}`;
		const newest = flows.get(key);
		if (newest && newest.endedAt >= report.endedAt) continue;
		flows.set(key, {
			...report,
			key,
			group,
			title: run.flowName ?? run.title,
		});
	}
	return topRows([...flows.values()].sort((a, b) => b.endedAt - a.endedAt));
}
