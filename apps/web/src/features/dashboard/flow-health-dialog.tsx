import { Button } from "@nightshift/ui/components/button";
import { DialogFooter } from "@nightshift/ui/components/dialog";
import { Link } from "@tanstack/react-router";
import { ArrowRightIcon } from "lucide-react";
import { useState } from "react";
import type { Project, RunSummary } from "@/shared/api";
import {
	formatCost,
	formatDateTime,
	formatDuration,
	formatKnownCost,
	sumKnownCost,
	useNow,
} from "@/shared/format";
import {
	DetailsDialog,
	DetailsEmpty,
	DetailsHeader,
	DetailsTabContent,
	DetailsTabs,
	type NightRange,
	NightRangeToggle,
	Stat,
} from "./details";
import { CostPerRun, RunsPerNight } from "./flow-health-charts";
import { LatestRuns, Warnings, WhyUnfinished } from "./flow-health-tables";
import {
	type FlowRun,
	finishedCostOf,
	hasEnded,
	runsOf,
	spreadOf,
} from "./flow-runs";
import { inLastNights } from "./nights";
import { OVERVIEW_ROWS } from "./overview";

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
	runs,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	flowName: string;
	project: Project;
	runs: RunSummary[];
}) {
	return (
		<DetailsDialog open={open} onOpenChange={onOpenChange}>
			<FlowHealthDetails
				flowName={flowName}
				project={project}
				runs={runs}
				onNavigate={() => onOpenChange(false)}
			/>
		</DetailsDialog>
	);
}

function FlowHealthDetails({
	flowName,
	project,
	runs,
	onNavigate,
}: {
	flowName: string;
	project: Project;
	runs: RunSummary[];
	onNavigate: () => void;
}) {
	const now = useNow(60_000);
	const [range, setRange] = useState<NightRange>(30);
	const [tab, setTab] = useState<Tab>("overview");
	const inRange = runsOf(flowName, runs)
		.filter((run) => inLastNights(run.startedAt, range, now))
		.sort((a, b) => a.startedAt - b.startedAt);
	const asSubflow = inRange.filter((run) => run.calledBy !== null).length;
	const ended = inRange.filter(hasEnded);
	const finished = ended.filter((run) => run.status === "finished");
	const unfinished = ended.filter((run) => run.status !== "finished");
	const { cost } = finishedCostOf(finished);
	const warnings = inRange.reduce(
		(total, run) => total + run.warnings.length,
		0,
	);
	const length = spreadOf(
		finished.flatMap((run) =>
			run.endedAt === null ? [] : [run.endedAt - run.startedAt],
		),
	);
	const spent = sumKnownCost(inRange);
	const spentUnfinished = sumKnownCost(unfinished);

	const dearest = ended.reduce<FlowRun | undefined>(
		(top, run) => (top === undefined || run.costUsd > top.costUsd ? run : top),
		undefined,
	);

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
						count: unfinished.length + warnings,
					},
					{ value: "runs", label: "Runs" },
				]}
				value={tab}
				onValueChange={setTab}
				toggle={<NightRangeToggle value={range} onValueChange={setRange} />}
			>
				{inRange.length === 0 ? (
					<DetailsEmpty>
						This flow did not run in the last {range} nights.
					</DetailsEmpty>
				) : (
					<>
						<DetailsTabContent value="overview">
							<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
								<Stat
									label="Runs"
									value={String(inRange.length)}
									hint={
										asSubflow > 0
											? `${asSubflow} as a subflow`
											: "All on its own"
									}
								/>
								<Stat
									label="Finished"
									value={
										ended.length > 0
											? `${Math.round((finished.length / ended.length) * 100)}%`
											: "—"
									}
									hint={`${finished.length} of ${ended.length} ended runs`}
								/>
								<Stat
									label="Per finished run"
									value={cost ? formatCost(cost.median) : "—"}
									hint={
										cost && cost.count > 1
											? `Half cost ${formatCost(cost.q1)} to ${formatCost(cost.q3)}`
											: undefined
									}
								/>
								<Stat
									label="Typical length"
									value={length ? formatDuration(length.median) : "—"}
									hint={
										length && length.count > 1
											? `Half take ${formatDuration(length.q1)} to ${formatDuration(length.q3)}`
											: undefined
									}
								/>
							</div>
							<RunsPerNight runs={inRange} range={range} now={now} />
						</DetailsTabContent>

						<DetailsTabContent value="cost">
							<div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
								<Stat label="Spent in all" value={formatKnownCost(spent)} />
								<Stat
									label="Not finished"
									value={formatKnownCost(spentUnfinished)}
									hint={
										unfinished.length === 1
											? "Spent by 1 run"
											: `Spent by ${unfinished.length} runs`
									}
								/>
								<Stat
									label="Dearest run"
									value={dearest ? formatCost(dearest.costUsd) : "—"}
									hint={dearest ? formatDateTime(dearest.startedAt) : undefined}
								/>
							</div>
							<CostPerRun runs={ended} median={cost?.median} />
						</DetailsTabContent>

						<DetailsTabContent value="problems">
							{unfinished.length + warnings === 0 ? (
								<DetailsEmpty>
									Every run in the last {range} nights finished, without
									warnings.
								</DetailsEmpty>
							) : null}
							{unfinished.length > 0 ? (
								<WhyUnfinished runs={unfinished} now={now} />
							) : null}
							{warnings > 0 ? (
								<Warnings runs={inRange} now={now} onNavigate={onNavigate} />
							) : null}
						</DetailsTabContent>

						<DetailsTabContent value="runs">
							<LatestRuns
								runs={inRange.slice(-OVERVIEW_ROWS).reverse()}
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
