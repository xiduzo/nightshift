/** PROTOTYPE, throw away. Pieces more than one Home variant uses. */

import { Link } from "@tanstack/react-router";
import { HourglassIcon, LoaderCircleIcon } from "lucide-react";
import { RunStatusIcon } from "@/features/runs";
import type {
	DashboardSummary,
	FlowHealthRow,
	NightRange,
	NightsRange,
	OpenGate,
} from "@/shared/api";
import { formatDateTime, formatRelative, formatTime } from "@/shared/format";
import { GatesDialog } from "../gates-dialog";
import type { Metric } from "../metrics";
import { RunsDialog } from "../runs-dialog";

/** A last run, and the flow it ran. */
export type LastRun = FlowHealthRow["lastRuns"][number] & { flow?: string };

import { SpendDialog } from "../spend-dialog";

/** A project's last runs over all its flows, newest first. */
export function lastRunsOf(
	nights: NightsRange | undefined,
	count = 10,
): LastRun[] {
	const seen = new Set<string>();
	return (nights?.flows?.rows ?? [])
		.flatMap((flow) =>
			flow.lastRuns.map((run) => ({ ...run, flow: flow.name })),
		)
		.sort((a, b) => b.startedAt - a.startedAt)
		.filter((run) => !seen.has(run.runId) && seen.add(run.runId))
		.slice(0, count);
}

/** Status icons of the last runs, and when the newest started. */
export function LastRunsStrip({
	runs,
	now,
	oneLine = false,
	linked = true,
}: {
	runs: LastRun[];
	now: number;
	oneLine?: boolean;
	/** False inside a row that links somewhere itself: the icons only show. */
	linked?: boolean;
}) {
	const [last] = runs;
	if (!last) {
		return <span className="text-muted-foreground text-xs">No runs yet</span>;
	}
	return (
		<div
			className={
				oneLine ? "flex items-center gap-2" : "flex flex-col items-start gap-1"
			}
		>
			<div className="flex items-center gap-0.5">
				{runs.map((run) => {
					const icon = (
						<RunStatusIcon
							status={run.status}
							context={{
								before: run.flow,
								after: formatRelative(run.startedAt, now),
							}}
						/>
					);
					return linked ? (
						<Link
							key={run.runId}
							to="/runs/$runId"
							params={{ runId: run.runId }}
							onClick={(event) => event.stopPropagation()}
							className="rounded-sm p-0.5 hover:bg-muted"
						>
							{icon}
						</Link>
					) : (
						<span key={run.runId} className="p-0.5">
							{icon}
						</span>
					);
				})}
			</div>
			<time
				dateTime={new Date(last.startedAt).toISOString()}
				title={formatDateTime(last.startedAt)}
				className="text-muted-foreground text-xs"
			>
				Last run {formatRelative(last.startedAt, now)}
			</time>
		</div>
	);
}

/** What runs and waits now over every project. Nothing when all is quiet. */
export function HomeNow({
	summary,
	gates,
}: {
	summary: DashboardSummary | undefined;
	gates: OpenGate[];
}) {
	const running = summary?.cards.running ?? 0;
	const nextWake = summary?.cards.nextWakeAt ?? null;
	if (running === 0 && gates.length === 0) return null;
	return (
		<div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg border bg-muted/40 px-4 py-2 text-sm">
			{running > 0 ? (
				<span className="flex items-center gap-2">
					<LoaderCircleIcon className="size-4 animate-spin text-status-running" />
					{running} running now
				</span>
			) : null}
			{gates.length > 0 ? (
				<Link to="/inbox" className="flex items-center gap-2 hover:underline">
					<HourglassIcon className="size-4 text-status-waiting" />
					{gates.length} {gates.length === 1 ? "Gate waits" : "Gates wait"} for
					you
				</Link>
			) : null}
			{nextWake ? (
				<span className="text-muted-foreground">
					Next wake-up at {formatTime(nextWake)}
				</span>
			) : null}
		</div>
	);
}

/** The details of a number over every project, at the page's range. */
export function HomeDetails({
	metric,
	open,
	onOpenChange,
	summary,
	range,
	gates,
}: {
	metric: Metric;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	summary: DashboardSummary;
	range: NightRange;
	gates: OpenGate[];
}) {
	const props = { open, onOpenChange, summary, initialRange: range };
	if (metric === "spend") return <SpendDialog {...props} />;
	if (metric === "gates") return <GatesDialog {...props} gates={gates} />;
	return (
		<RunsDialog
			{...props}
			initialTab={metric === "finished" ? "failed" : "overview"}
		/>
	);
}
