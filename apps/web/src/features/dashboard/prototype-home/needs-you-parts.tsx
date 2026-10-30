/** PROTOTYPE, throw away. Pieces the "Needs you first" variants share. */

import { Button } from "@nightshift/ui/components/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@nightshift/ui/components/card";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { Link } from "@tanstack/react-router";
import { ArrowRightIcon } from "lucide-react";
import { useState } from "react";
import type { NightRange } from "@/shared/api";
import { formatRelative, useNow } from "@/shared/format";
import { METRICS, type Metric } from "../metrics";
import { RangeBar } from "../range-bar";
import { changeOf, Sparkline } from "./home-data";
import { HomeDetails, LastRunsStrip } from "./home-parts";
import type {
	NeedsYouData,
	NeedsYouFailure,
	NeedsYouGate,
	NeedsYouProject,
} from "./needs-you-data";

export type NeedsYouProps = {
	data: NeedsYouData;
	range: NightRange;
	onRangeChange: (range: NightRange) => void;
};

/** A link that goes nowhere on sample data. */
function SampleSafeLink({
	sample,
	to,
	runId,
	projectId,
	range,
	className,
	children,
}: {
	sample: boolean;
	to: "/inbox" | "/runs/$runId" | "/projects/$projectId";
	runId?: string;
	projectId?: string;
	range?: NightRange;
	className?: string;
	children: React.ReactNode;
}) {
	if (sample) return <span className={className}>{children}</span>;
	if (to === "/runs/$runId" && runId) {
		return (
			<Link to={to} params={{ runId }} className={className}>
				{children}
			</Link>
		);
	}
	if (to === "/projects/$projectId" && projectId) {
		return (
			<Link
				to={to}
				params={{ projectId }}
				search={{ range }}
				className={className}
			>
				{children}
			</Link>
		);
	}
	return (
		<Link to="/inbox" className={className}>
			{children}
		</Link>
	);
}

/** The details of a number. Only with real data: the dialogs need it. */
export function useMetricDetails(data: NeedsYouData, range: NightRange) {
	const [details, setDetails] = useState<{ metric: Metric; open: boolean }>();
	const dialog =
		data.summary && details ? (
			<HomeDetails
				metric={details.metric}
				open={details.open}
				onOpenChange={(open) => setDetails({ ...details, open })}
				summary={data.summary}
				range={range}
				gates={data.realGates}
			/>
		) : null;
	return {
		open: (metric: Metric) => setDetails({ metric, open: true }),
		dialog,
	};
}

/**
 * The four numbers with a small line each, against the nights before.
 * `rail` stacks them, `strip` puts them in one row.
 */
export function MetricList({
	data,
	onDetails,
	layout = "rail",
}: {
	data: NeedsYouData;
	onDetails: (metric: Metric) => void;
	layout?: "rail" | "strip";
}) {
	const { metrics } = data;
	return (
		<Card className="gap-0 py-0">
			<div
				className={
					layout === "strip"
						? "grid grid-cols-2 divide-x lg:grid-cols-4"
						: "flex flex-col divide-y"
				}
			>
				{METRICS.map((each) => {
					const change = metrics
						? changeOf(
								each.key,
								metrics.values[each.key],
								metrics.before[each.key],
								metrics.compared,
							)
						: undefined;
					return (
						<button
							key={each.key}
							type="button"
							onClick={() => onDetails(each.key)}
							className="grid grid-cols-[1fr_96px] items-center gap-3 px-4 py-3 text-left hover:bg-muted/50"
						>
							<span className="flex flex-col">
								<span className="text-muted-foreground text-xs">
									{each.label}
								</span>
								<span className="font-semibold text-xl tabular-nums">
									{metrics ? each.format(metrics.values[each.key]) : "…"}
								</span>
								{change ? (
									<span className="flex items-center gap-1 text-muted-foreground text-xs [&_svg]:size-3">
										{change.icon}
										{change.short}
									</span>
								) : null}
							</span>
							{metrics ? (
								<Sparkline
									rows={metrics.rows}
									metric={each.key}
									color={each.color}
									compared={metrics.compared}
								/>
							) : null}
						</button>
					);
				})}
			</div>
		</Card>
	);
}

/** The range and the numbers, for the right-hand rail. */
export function NumbersRail({
	data,
	range,
	onRangeChange,
	onDetails,
}: NeedsYouProps & { onDetails: (metric: Metric) => void }) {
	return (
		<>
			<RangeBar value={range} onValueChange={onRangeChange} />
			<MetricList data={data} onDetails={onDetails} />
		</>
	);
}

/** Each project and its last runs. */
export function ProjectsCard({
	data,
	range,
	title = "Projects",
}: {
	data: NeedsYouData;
	range: NightRange;
	title?: string;
}) {
	const now = useNow();
	return (
		<Card size="sm">
			<CardHeader>
				<CardTitle>{title}</CardTitle>
			</CardHeader>
			<CardContent>
				<ItemGroup className="gap-1">
					{data.projects.map((project) => (
						<ProjectItem
							key={project.id}
							project={project}
							sample={data.sample}
							range={range}
							now={now}
						/>
					))}
				</ItemGroup>
			</CardContent>
		</Card>
	);
}

function ProjectItem({
	project,
	sample,
	range,
	now,
}: {
	project: NeedsYouProject;
	sample: boolean;
	range: NightRange;
	now: number;
}) {
	return (
		<Item size="sm" className="px-0">
			<ItemContent>
				<ItemTitle>
					<SampleSafeLink
						sample={sample}
						to="/projects/$projectId"
						projectId={project.id}
						range={range}
						className="hover:underline"
					>
						{project.name}
					</SampleSafeLink>
				</ItemTitle>
				<div className="text-sm">
					<LastRunsStrip runs={project.lastRuns.slice(0, 8)} now={now} />
				</div>
			</ItemContent>
		</Item>
	);
}

/** An open Gate: the question, where it comes from, how long it waits. */
export function GateItem({
	gate,
	sample,
	showChoices = false,
}: {
	gate: NeedsYouGate;
	sample: boolean;
	showChoices?: boolean;
}) {
	const now = useNow();
	return (
		<Item variant="outline" size="sm">
			<ItemContent>
				<ItemTitle>{gate.question}</ItemTitle>
				<ItemDescription>
					{gate.projectName} · {gate.flowName ?? gate.runTitle} · waits since{" "}
					{formatRelative(gate.openedAt, now)}
				</ItemDescription>
			</ItemContent>
			<ItemActions>
				{showChoices ? (
					gate.choices.map((choice) => (
						<Button key={choice} variant="outline" size="sm">
							{choice}
						</Button>
					))
				) : (
					<Button
						variant="ghost"
						size="sm"
						nativeButton={sample}
						render={sample ? undefined : <Link to="/inbox" />}
					>
						Answer
						<ArrowRightIcon data-icon="inline-end" />
					</Button>
				)}
			</ItemActions>
		</Item>
	);
}

/** A failed run: its flow, why it failed, when. */
export function FailureItem({
	run,
	sample,
	showProject = false,
}: {
	run: NeedsYouFailure;
	sample: boolean;
	showProject?: boolean;
}) {
	const now = useNow();
	return (
		<Item size="sm" className="py-1.5">
			<ItemContent>
				<ItemTitle>
					<SampleSafeLink
						sample={sample}
						to="/runs/$runId"
						runId={run.id}
						className="hover:underline"
					>
						{showProject ? `${run.project} · ${run.title}` : run.title}
					</SampleSafeLink>
				</ItemTitle>
				<ItemDescription>{run.reason ?? "No reason given"}</ItemDescription>
			</ItemContent>
			<ItemActions className="text-muted-foreground text-xs">
				{formatRelative(run.createdAt, now)}
			</ItemActions>
		</Item>
	);
}

/** The failures per project, the project with the most first. */
export function failuresByProject(
	rows: NeedsYouFailure[],
): [string, NeedsYouFailure[]][] {
	const groups = new Map<string, NeedsYouFailure[]>();
	for (const run of rows) {
		groups.set(run.project, [...(groups.get(run.project) ?? []), run]);
	}
	return [...groups].sort((a, b) => b[1].length - a[1].length);
}
