import { daysOf } from "@nightshift/client";
import { Button } from "@nightshift/ui/components/button";
import { Card } from "@nightshift/ui/components/card";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ZapIcon } from "lucide-react";
import { useState } from "react";
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
import { dashboardQueries } from "./queries";
import { RangeBar } from "./range-bar";

/**
 * The project's root: where each of its flows still needs you. One range
 * for the whole page. On top, one number: how often the flows needed you
 * without a plan, against the days before. Under it, one row per flow.
 * What the flows spent is on the Spend page, one button away.
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
	const days = summary.data ? daysOf(summary.data, range) : undefined;

	return (
		<ProjectPage projectId={projectId}>
			{(project) => (
				<>
					<PageHeading
						title={project.name}
						description={<ProjectFolderLine project={project} />}
						actions={
							<>
								<Button
									variant="ghost"
									size="sm"
									nativeButton={false}
									render={<Link to="/spend" search={{ range }} />}
								>
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
					<NeededYou days={days} range={range} />
					<Card className="gap-0 py-0">
						<FlowRows
							project={project}
							rows={days?.flows?.rows}
							range={range}
						/>
					</Card>

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

/**
 * How often the flows needed you without a plan over the range, against
 * the days before. An older Host sends no watch: nothing.
 */
function NeededYou({
	days,
	range,
}: {
	/** Undefined while it loads. */
	days: NightsRange | undefined;
	range: NightRange;
}) {
	if (!days) return <Skeleton className="h-7 w-80" />;
	const watches = (days.flows?.rows ?? []).flatMap((row) =>
		row.watch ? [row.watch.attention] : [],
	);
	if (watches.length === 0) return null;
	const now = watches.reduce((sum, a) => sum + a.unplanned, 0);
	const before = watches.reduce((sum, a) => sum + a.before.unplanned, 0);
	return (
		<p className="flex flex-wrap items-baseline gap-x-2 text-sm">
			<span className="font-semibold text-xl tabular-nums">{now}</span>
			<span className="text-muted-foreground">
				{now === 1 ? "time" : "times"} a flow needed you without a plan in the
				last {range} days
			</span>
			<Against now={now} before={before} />
		</p>
	);
}
