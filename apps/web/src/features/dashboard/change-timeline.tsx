import { changeSummary, type FlowChanges } from "@nightshift/client";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import { cn } from "@nightshift/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { formatCost, formatRelative } from "@/shared/format";

/**
 * The runs of a flow on a line in time, over twice the page's range: the
 * days before it dimmed, a mark at each change of the flow, and the time
 * since the change the table measures shaded. A run is a dot: green when
 * it finished, red when not, with a ring when it needed you without a
 * plan. A dot opens its run.
 */
export function ChangeTimeline({
	changes,
	now,
}: {
	changes: FlowChanges;
	now: number;
}) {
	const { from, split, to } = changes.window;
	const span = Math.max(to - from, 1);
	const x = (at: number) =>
		`${Math.min(Math.max(((at - from) / span) * 100, 0), 100)}%`;
	const measured = changes.pending ?? changes.lastChange?.change ?? null;
	return (
		<div className="flex flex-col gap-1">
			<div className="relative h-12 overflow-hidden rounded-md border bg-background">
				<div
					className="absolute inset-y-0 left-0 bg-muted/60"
					style={{ width: x(split) }}
				/>
				{measured ? (
					<div
						className="absolute inset-y-0 right-0 bg-status-running/10"
						style={{ left: x(measured.firstAt) }}
					/>
				) : null}
				<div className="absolute inset-x-0 top-1/2 h-px bg-border" />
				{changes.changes.map((change) => (
					<Tooltip key={change.firstAt}>
						<TooltipTrigger
							render={
								<span
									className="absolute inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-status-running"
									style={{ left: x(change.at) }}
								/>
							}
						/>
						<TooltipContent className="flex flex-col items-start">
							<span>You changed the flow {formatRelative(change.at, now)}</span>
							<span className="text-muted-foreground">
								{changeSummary(change)}
								{change.saves > 1 ? ` · ${change.saves} saves` : ""}
							</span>
						</TooltipContent>
					</Tooltip>
				))}
				{changes.runs.map((run) => (
					<Tooltip key={run.runId}>
						<TooltipTrigger
							render={
								<Link
									to="/runs/$runId"
									params={{ runId: run.runId }}
									aria-label={`${run.finished ? "Finished" : "Did not finish"} ${formatRelative(run.startedAt, now)}`}
									className={cn(
										"absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring",
										run.finished ? "bg-status-finished" : "bg-status-failed",
										run.unplanned > 0 &&
											"ring-2 ring-status-waiting ring-offset-1 ring-offset-background",
									)}
									style={{ left: x(run.startedAt) }}
								/>
							}
						/>
						<TooltipContent className="flex flex-col items-start">
							<span>
								{run.finished ? "Finished" : "Did not finish"}{" "}
								{formatRelative(run.startedAt, now)}
							</span>
							<span>{formatCost(run.costUsd)}</span>
							{run.unplanned > 0 ? (
								<span>Needed you {run.unplanned}× without a plan</span>
							) : null}
						</TooltipContent>
					</Tooltip>
				))}
			</div>
			<div className="relative h-4 text-muted-foreground text-xs">
				<span className="absolute left-0">{changes.nights * 2} days ago</span>
				<span className="absolute -translate-x-1/2" style={{ left: x(split) }}>
					{changes.nights} days ago
				</span>
				<span className="absolute right-0">Now</span>
			</div>
			<div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-xs">
				<span className="flex items-center gap-1.5">
					<span className="size-2 rounded-full bg-status-finished" />
					Finished
				</span>
				<span className="flex items-center gap-1.5">
					<span className="size-2 rounded-full bg-status-failed" />
					Did not finish
				</span>
				<span className="flex items-center gap-1.5">
					<span className="size-2 rounded-full ring-2 ring-status-waiting" />
					Needed you without a plan
				</span>
				<span className="flex items-center gap-1.5">
					<span className="h-3 w-0.5 rounded-full bg-status-running" />
					You changed the flow
				</span>
			</div>
		</div>
	);
}
