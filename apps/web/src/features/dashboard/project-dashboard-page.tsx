import { daysOf, FLOW_LEVELS, flowLevelLabel } from "@nightshift/client";
import { Button } from "@nightshift/ui/components/button";
import { Card, CardContent } from "@nightshift/ui/components/card";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import { useQuery } from "@tanstack/react-query";
import { ZapIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import {
	CopyProjectHere,
	ProjectFolderLine,
	ProjectMenu,
	ProjectPage,
} from "@/features/projects";
import { QuickRunDialog } from "@/features/runs";
import type { NightRange, NightsRange } from "@/shared/api";
import { PageHeading } from "@/shared/page";
import { Against, FlowRows } from "./flow-rows";
import { MetricDetails } from "./metric-details";
import type { Metric } from "./metrics";
import { dashboardQueries } from "./queries";
import { RangeBar } from "./range-bar";
import { RUN_STATUS_CHART } from "./run-statuses";

/**
 * The project's root: where each of its flows still needs you. One range
 * for the whole page. On top, how often the flows needed you without a
 * plan and as planned, how many run on their own, and how the runs ended,
 * each against the days before where it has them. Under it, one row per
 * flow that opens in place. What the project spent is one button away,
 * until Spend has its own page.
 */
export function ProjectDashboardPage({
	projectId,
	range,
	onRangeChange,
}: {
	projectId: string;
	range: NightRange;
	onRangeChange: (range: NightRange) => void;
}) {
	const summary = useQuery(dashboardQueries.summary({ projectId }));
	const [quickRun, setQuickRun] = useState(false);
	// The metric stays while the dialog closes, so its body does not go blank.
	const [details, setDetails] = useState<{ metric: Metric; open: boolean }>();
	const days = summary.data ? daysOf(summary.data, range) : undefined;
	const show = (metric: Metric) => setDetails({ metric, open: true });

	return (
		<ProjectPage projectId={projectId}>
			{(project) => (
				<>
					<PageHeading
						title={project.name}
						description={<ProjectFolderLine project={project} />}
						actions={
							<>
								<Button variant="ghost" size="sm" onClick={() => show("spend")}>
									Spend
								</Button>
								<Button
									variant="outline"
									size="sm"
									onClick={() => setQuickRun(true)}
								>
									<ZapIcon data-icon="inline-start" />
									Quick run
								</Button>
								<ProjectMenu project={project} variant="outline" />
							</>
						}
					/>

					<CopyProjectHere project={project} />

					<RangeBar value={range} onValueChange={onRangeChange} />
					<Card>
						<CardContent className="grid gap-6 sm:grid-cols-2 lg:grid-cols-[repeat(3,auto)_1fr]">
							<Numbers
								days={days}
								levels={summary.data?.watch?.levels}
								onNeeded={() => show("needed")}
							/>
							<RunsEnded days={days} onDetails={() => show("runs")} />
						</CardContent>
					</Card>
					<Card className="gap-0 py-0">
						<FlowRows
							project={project}
							rows={days?.flows?.rows}
							range={range}
						/>
					</Card>

					{summary.data && details ? (
						<MetricDetails
							metric={details.metric}
							open={details.open}
							onOpenChange={(open) => setDetails({ ...details, open })}
							project={project}
							summary={summary.data}
							range={range}
						/>
					) : null}
					<QuickRunDialog
						projectId={project.id}
						open={quickRun}
						onOpenChange={setQuickRun}
					/>
				</>
			)}
		</ProjectPage>
	);
}

function Figure({
	label,
	value,
	sub,
}: {
	label: string;
	value: ReactNode;
	sub?: ReactNode;
}) {
	return (
		<div className="flex flex-col gap-0.5">
			<span className="text-muted-foreground text-xs">{label}</span>
			<span className="font-semibold text-xl tabular-nums">{value}</span>
			{sub}
		</div>
	);
}

/**
 * How often the flows needed you over the range, and how many run on
 * their own. An older Host sends no watch: a dash.
 */
function Numbers({
	days,
	levels,
	onNeeded,
}: {
	/** Undefined while it loads. */
	days: NightsRange | undefined;
	levels: Record<(typeof FLOW_LEVELS)[number], number> | undefined;
	onNeeded: () => void;
}) {
	if (!days) {
		return (
			<>
				<Skeleton className="h-14 w-40" />
				<Skeleton className="h-14 w-40" />
				<Skeleton className="h-14 w-40" />
			</>
		);
	}
	const watches = (days.flows?.rows ?? []).flatMap((row) =>
		row.watch ? [row.watch.attention] : [],
	);
	const known = watches.length > 0;
	const sum = (pick: (attention: (typeof watches)[number]) => number) =>
		watches.reduce((total, attention) => total + pick(attention), 0);
	const withLevel = levels
		? FLOW_LEVELS.reduce((total, level) => total + levels[level], 0)
		: 0;
	return (
		<>
			<Figure
				label="Needed you without a plan"
				value={known ? sum((a) => a.unplanned) : "—"}
				sub={
					known ? (
						<span className="flex items-center gap-2">
							<Against
								now={sum((a) => a.unplanned)}
								before={sum((a) => a.before.unplanned)}
							/>
							<Button
								variant="link"
								size="xs"
								className="h-auto px-0"
								onClick={onNeeded}
							>
								Details
							</Button>
						</span>
					) : null
				}
			/>
			<Figure
				label="Needed you as planned"
				value={known ? sum((a) => a.planned) : "—"}
				sub={
					known ? (
						<Against
							now={sum((a) => a.planned)}
							before={sum((a) => a.before.planned)}
						/>
					) : null
				}
			/>
			<Figure
				label={flowLevelLabel("own")}
				value={levels && withLevel > 0 ? `${levels.own} of ${withLevel}` : "—"}
				sub={
					<span className="text-muted-foreground text-xs">
						{levels && withLevel > 0
							? `${levels.check} ${flowLevelLabel("check").toLowerCase()}, ${levels.decide} ${flowLevelLabel("decide").toLowerCase()}`
							: "No flow has a level yet"}
					</span>
				}
			/>
		</>
	);
}

/** How the runs of the range ended, as one bar. It opens the runs. */
function RunsEnded({
	days,
	onDetails,
}: {
	days: NightsRange | undefined;
	onDetails: () => void;
}) {
	if (!days) return <Skeleton className="h-14 w-full" />;
	const { runs, statuses } = days.runs;
	return (
		<div className="flex min-w-0 flex-col justify-center gap-2">
			<span className="flex items-baseline gap-2 text-muted-foreground text-xs">
				How {runs} {runs === 1 ? "run" : "runs"} ended
				<Button
					variant="link"
					size="xs"
					className="h-auto px-0"
					onClick={onDetails}
				>
					Details
				</Button>
			</span>
			<span className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
				{statuses.map(({ status, count }) => (
					<Tooltip key={status}>
						<TooltipTrigger
							render={<span />}
							style={{
								width: `${(count / Math.max(1, runs)) * 100}%`,
								background: RUN_STATUS_CHART[status].color,
							}}
						/>
						<TooltipContent>
							{RUN_STATUS_CHART[status].label}: {count}
						</TooltipContent>
					</Tooltip>
				))}
			</span>
			<span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
				{statuses.map(({ status, count }) => (
					<span key={status} className="flex items-center gap-1">
						<span
							className="size-2 rounded-full"
							style={{ background: RUN_STATUS_CHART[status].color }}
						/>
						<span className="text-muted-foreground">
							{RUN_STATUS_CHART[status].label}
						</span>
						<span className="tabular-nums">{count}</span>
					</span>
				))}
			</span>
		</div>
	);
}
