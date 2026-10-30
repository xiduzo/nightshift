import { Button } from "@nightshift/ui/components/button";
import { Card, CardContent } from "@nightshift/ui/components/card";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { ZapIcon } from "lucide-react";
import { useState } from "react";
import { useOpenGates } from "@/features/gates";
import {
	CopyProjectHere,
	ProjectFolderLine,
	ProjectMenu,
	ProjectPage,
} from "@/features/projects";
import { QuickRunDialog } from "@/features/runs";
import type { DashboardSummary, NightRange, Project } from "@/shared/api";
import { PageHeading } from "@/shared/page";
import { GatesDialog } from "./gates-dialog";
import { MetricTiles } from "./metric-tiles";
import { type Metric, metricsOf } from "./metrics";
import { MetricsChart } from "./metrics-chart";
import { NowStrip } from "./now-strip";
import { ProjectTables } from "./project-tables";
import { dashboardQueries } from "./queries";
import { RangeBar } from "./range-bar";
import { nightsOf } from "./ranges";
import { RunsDialog } from "./runs-dialog";
import { SpendDialog } from "./spend-dialog";

/**
 * The project's root, after the Performance page of Search Console: one
 * range for the whole page, four numbers that each compare with the nights
 * before, one chart of the ones you switch on, and the lists under it.
 * What runs or waits now shows only when there is something.
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
	const [on, setOn] = useState<Metric[]>(["runs", "finished"]);
	// The metric stays while the dialog closes, so its body does not go blank.
	const [details, setDetails] = useState<{ metric: Metric; open: boolean }>();
	const nights = summary.data ? nightsOf(summary.data, range) : undefined;
	const metrics = nights ? metricsOf(nights) : undefined;

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
					<NowStrip projectId={project.id} summary={summary.data} />
					<MetricTiles
						values={metrics?.values}
						before={metrics?.before}
						on={on}
						onChange={setOn}
						onDetails={(metric) => setDetails({ metric, open: true })}
					/>
					<Card>
						<CardContent>
							{metrics ? (
								<MetricsChart rows={metrics.rows} on={on} />
							) : (
								<Skeleton className="h-72 w-full" />
							)}
						</CardContent>
					</Card>
					<ProjectTables project={project} range={nights} />

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

/**
 * The details of a number, at the page's range: Runs and Finished open the
 * runs (Finished on the failed ones), Spend and Gates their own.
 */
function MetricDetails({
	metric,
	open,
	onOpenChange,
	project,
	summary,
	range,
}: {
	metric: Metric;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	project: Project;
	summary: DashboardSummary;
	range: NightRange;
}) {
	const gates = useOpenGates();
	const props = {
		open,
		onOpenChange,
		summary,
		project,
		initialRange: range,
	};

	if (metric === "spend") return <SpendDialog {...props} />;
	if (metric === "gates") {
		return (
			<GatesDialog
				{...props}
				gates={
					gates.data?.filter((gate) => gate.projectId === project.id) ?? []
				}
			/>
		);
	}
	return (
		<RunsDialog
			{...props}
			initialTab={metric === "finished" ? "failed" : "overview"}
		/>
	);
}
