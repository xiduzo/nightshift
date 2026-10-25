import { Button } from "@nightshift/ui/components/button";
import { DialogFooter } from "@nightshift/ui/components/dialog";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRightIcon } from "lucide-react";
import { useState } from "react";
import type { NightRange, Project } from "@/shared/api";
import {
	formatCost,
	formatDateTime,
	formatDuration,
	formatKnownCost,
	useNow,
} from "@/shared/format";
import {
	DetailsDialog,
	DetailsEmpty,
	DetailsHeader,
	DetailsTabContent,
	DetailsTabs,
	NightRangeToggle,
	Stat,
} from "./details";
import { CostPerRun, RunsPerNight } from "./flow-health-charts";
import { LatestRuns, Warnings, WhyUnfinished } from "./flow-health-tables";
import { dashboardQueries } from "./queries";

type Tab = "overview" | "cost" | "problems" | "runs";

/**
 * One flow in detail, behind its Flow health row, in tabs so each view stays
 * small: an overview with runs per night, what each run cost against the
 * median, why runs did not finish, and the latest runs. One range drives
 * every tab. Runs as a subflow count, as in the row.
 */
export function FlowHealthDialog({
	open,
	onOpenChange,
	flowName,
	project,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	flowName: string;
	project: Project;
}) {
	return (
		<DetailsDialog open={open} onOpenChange={onOpenChange}>
			<FlowHealthDetails
				flowName={flowName}
				project={project}
				onNavigate={() => onOpenChange(false)}
			/>
		</DetailsDialog>
	);
}

function FlowHealthDetails({
	flowName,
	project,
	onNavigate,
}: {
	flowName: string;
	project: Project;
	onNavigate: () => void;
}) {
	const now = useNow(60_000);
	const [range, setRange] = useState<NightRange>(30);
	const [tab, setTab] = useState<Tab>("overview");
	const detail = useQuery(dashboardQueries.flow(project.id, flowName));
	const inRange = detail.data?.ranges.find((r) => r.nights === range);
	const unfinished = inRange?.unfinished ?? 0;
	const warnings = inRange?.warnings ?? 0;

	return (
		<>
			<DetailsHeader project={project} trail="Flow health" title={flowName} />

			<DetailsTabs
				tabs={[
					{ value: "overview", label: "Overview" },
					{ value: "cost", label: "Cost" },
					{
						value: "problems",
						label: "Problems",
						count: unfinished + warnings,
					},
					{ value: "runs", label: "Runs" },
				]}
				value={tab}
				onValueChange={setTab}
				toggle={
					<NightRangeToggle
						ranges={detail.data?.ranges.map((r) => r.nights) ?? []}
						value={range}
						onValueChange={setRange}
					/>
				}
			>
				{detail.error && !inRange ? (
					<DetailsEmpty>
						This flow could not load. Close it and open it again.
					</DetailsEmpty>
				) : !inRange ? (
					<div className="flex flex-col gap-3 pt-2">
						<Skeleton className="h-20 w-full" />
						<Skeleton className="h-48 w-full" />
					</div>
				) : inRange.runs === 0 ? (
					<DetailsEmpty>
						This flow did not run in the last {range} nights.
					</DetailsEmpty>
				) : (
					<>
						<DetailsTabContent value="overview">
							<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
								<Stat
									label="Runs"
									value={String(inRange.runs)}
									hint={
										inRange.asSubflow > 0
											? `${inRange.asSubflow} as a subflow`
											: "All on its own"
									}
								/>
								<Stat
									label="Finished"
									value={
										inRange.ended > 0
											? `${Math.round((inRange.finished / inRange.ended) * 100)}%`
											: "—"
									}
									hint={`${inRange.finished} of ${inRange.ended} ended runs`}
								/>
								<Stat
									label="Per finished run"
									value={inRange.cost ? formatCost(inRange.cost.median) : "—"}
									hint={
										inRange.cost && inRange.cost.count > 1
											? `Half cost ${formatCost(inRange.cost.q1)} to ${formatCost(inRange.cost.q3)}`
											: undefined
									}
								/>
								<Stat
									label="Typical length"
									value={
										inRange.length ? formatDuration(inRange.length.median) : "—"
									}
									hint={
										inRange.length && inRange.length.count > 1
											? `Half take ${formatDuration(inRange.length.q1)} to ${formatDuration(inRange.length.q3)}`
											: undefined
									}
								/>
							</div>
							<RunsPerNight
								perNight={inRange.perNight}
								statuses={inRange.statuses}
							/>
						</DetailsTabContent>

						<DetailsTabContent value="cost">
							<div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
								<Stat
									label="Spent in all"
									value={formatKnownCost(inRange.spent)}
								/>
								<Stat
									label="Not finished"
									value={formatKnownCost(inRange.spentUnfinished)}
									hint={
										unfinished === 1
											? "Spent by 1 run"
											: `Spent by ${unfinished} runs`
									}
								/>
								<Stat
									label="Dearest run"
									value={
										inRange.dearest ? formatCost(inRange.dearest.costUsd) : "—"
									}
									hint={
										inRange.dearest
											? formatDateTime(inRange.dearest.startedAt)
											: undefined
									}
								/>
							</div>
							<CostPerRun
								runs={inRange.endedRuns}
								median={inRange.cost?.median}
							/>
						</DetailsTabContent>

						<DetailsTabContent value="problems">
							{unfinished + warnings === 0 ? (
								<DetailsEmpty>
									Every run in the last {range} nights finished, without
									warnings.
								</DetailsEmpty>
							) : null}
							{unfinished > 0 ? (
								<WhyUnfinished reasons={inRange.whyUnfinished} now={now} />
							) : null}
							{warnings > 0 ? (
								<Warnings
									warnings={inRange.warningRows}
									now={now}
									onNavigate={onNavigate}
								/>
							) : null}
						</DetailsTabContent>

						<DetailsTabContent value="runs">
							<LatestRuns
								runs={inRange.latest}
								now={now}
								onNavigate={onNavigate}
							/>
						</DetailsTabContent>
					</>
				)}
			</DetailsTabs>

			<DialogFooter>
				<Button
					variant="outline"
					nativeButton={false}
					render={
						<Link
							to="/projects/$projectId/runs"
							params={{ projectId: project.id }}
							onClick={onNavigate}
						/>
					}
				>
					All runs
				</Button>
				<Button
					variant="outline"
					nativeButton={false}
					render={
						<Link
							to="/projects/$projectId/flows/$name"
							params={{ projectId: project.id, name: flowName }}
							onClick={onNavigate}
						/>
					}
				>
					Open flow
					<ArrowRightIcon data-icon="inline-end" />
				</Button>
			</DialogFooter>
		</>
	);
}
