import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useOpenGates } from "@/features/gates";
import { projectQueries } from "@/features/projects";
import { runQueries } from "@/features/runs";
import type { NightRange } from "@/shared/api";
import { PageHeading, SiteHeader } from "@/shared/page";
import { HomeLanes } from "./home-lanes";
import { HomeProjects } from "./home-projects";
import { MetricDetails } from "./metric-details";
import { MetricStrip } from "./metric-strip";
import { type Metric, metricsOf } from "./metrics";
import { dashboardQueries } from "./queries";
import { RangeBar } from "./range-bar";
import { nightsOf } from "./ranges";

/**
 * Home: what needs you over all projects. One range for the page, the four numbers
 * in a strip, then three lanes in the order you act on them (running,
 * waiting for you, failed), and the projects.
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
	const nights = summary.data ? nightsOf(summary.data, range) : undefined;
	const metrics = nights ? metricsOf(nights) : undefined;
	const running = (openRuns.data ?? []).filter(
		(run) => run.status === "running" || run.status === "sleeping",
	);
	const waiting = gates.data?.length ?? 0;
	const failed = nights?.runs.failed.count ?? 0;

	return (
		<>
			<SiteHeader crumbs={[{ label: "Home" }]} />
			<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
				<PageHeading
					title="Home"
					description={
						!nights
							? "What runs now, what waits for you and what failed in all your projects."
							: needsYou(waiting, failed, range)
					}
				/>
				<RangeBar value={range} onValueChange={onRangeChange} />
				<MetricStrip
					metrics={metrics}
					onDetails={(metric) => setDetails({ metric, open: true })}
				/>
				<HomeLanes
					running={running}
					gates={gates.data ?? []}
					failed={nights?.runs.failed}
					projects={projects.data}
					range={range}
					isLoading={openRuns.isLoading || gates.isLoading}
					onFailedDetails={() => setDetails({ metric: "finished", open: true })}
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

/** The line under the heading: what needs you, over the range of the page. */
function needsYou(waiting: number, failed: number, range: NightRange) {
	const gates =
		waiting === 0
			? "Nothing waits for you."
			: `${waiting} ${waiting === 1 ? "Gate waits" : "Gates wait"} for you.`;
	const runs =
		failed === 0
			? `No run failed in the last ${range} nights.`
			: `${failed} ${failed === 1 ? "run" : "runs"} failed in the last ${range} nights.`;
	return `${gates} ${runs}`;
}
