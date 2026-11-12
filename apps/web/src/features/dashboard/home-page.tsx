import { daysOf } from "@nightshift/client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { SetupCard } from "@/features/agents";
import { useOpenGates } from "@/features/gates";
import { projectQueries } from "@/features/projects";
import { runQueries } from "@/features/runs";
import type { NightRange } from "@/shared/api";
import { PageHeading, SiteHeader } from "@/shared/page";
import { HomeLanes } from "./home-lanes";
import { HomeProjects } from "./home-projects";
import { HomeReports } from "./home-reports";
import { MetricDetails } from "./metric-details";
import { MetricStrip } from "./metric-strip";
import { type Metric, metricsOf } from "./metrics";
import { dashboardQueries } from "./queries";
import { RangeBar } from "./range-bar";
import { latestReports } from "./reports";

/**
 * Home: what needs you, and what came out, over all projects. Before an
 * agent is ready, Get started on top. One range for the page, the four
 * numbers in a strip, then three lanes in the order you act on them
 * (running, waiting for you, failed), the latest reports, and the projects.
 */
export function HomePage({
	range,
	onRangeChange,
}: {
	range: NightRange;
	onRangeChange: (range: NightRange) => void;
}) {
	const summary = useQuery(dashboardQueries.summary());
	const projects = useQuery(projectQueries.list());
	const gates = useOpenGates();
	// At work or asleep now. A run at a Gate shows in its own lane.
	const openRuns = useQuery(runQueries.open());
	// The metric stays while the dialog closes, so its body does not go blank.
	const [details, setDetails] = useState<{ metric: Metric; open: boolean }>();
	const days = summary.data ? daysOf(summary.data, range) : undefined;
	const metrics = days ? metricsOf(days) : undefined;
	const running = (openRuns.data ?? []).filter(
		(run) => run.status === "running" || run.status === "sleeping",
	);
	const waiting = gates.data?.length ?? 0;
	const failing = days?.runs.stillFailing ?? 0;

	return (
		<>
			<SiteHeader crumbs={[{ label: "Home" }]} />
			<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
				<PageHeading
					title="Home"
					description={
						!days
							? "What runs now, what waits for you, what failed and what came out in all your projects."
							: needsYou(waiting, failing)
					}
				/>
				<SetupCard />
				<RangeBar value={range} onValueChange={onRangeChange} />
				<MetricStrip
					metrics={metrics}
					onDetails={(metric) => setDetails({ metric, open: true })}
				/>
				<HomeLanes
					running={running}
					gates={gates.data ?? []}
					failed={days?.runs}
					projects={projects.data}
					range={range}
					isLoading={openRuns.isLoading || gates.isLoading}
					onFailedDetails={() => setDetails({ metric: "finished", open: true })}
				/>
				<HomeReports
					reports={days ? latestReports(days.reports) : undefined}
					range={range}
				/>
				<HomeProjects projects={projects.data} range={range} />

				{summary.data && details ? (
					<MetricDetails
						metric={details.metric}
						open={details.open}
						onOpenChange={(open) => setDetails({ ...details, open })}
						summary={summary.data}
						range={range}
					/>
				) : null}
			</div>
		</>
	);
}

/**
 * The line under the heading: what needs you now.
 * `failing` counts the flows whose failure no later run made good.
 */
function needsYou(waiting: number, failing: number) {
	const gates =
		waiting === 0
			? "Nothing waits for you."
			: `${waiting} ${waiting === 1 ? "Gate waits" : "Gates wait"} for you.`;
	const flows =
		failing === 0
			? "No flow fails now."
			: `${failing} ${failing === 1 ? "flow still fails" : "flows still fail"}.`;
	return `${gates} ${flows}`;
}
