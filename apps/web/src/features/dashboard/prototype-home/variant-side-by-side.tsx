/**
 * PROTOTYPE, throw away. Home variant B, "Side by side": small multiples.
 * The totals shrink to one strip, and every project gets its own small
 * console. One metric picker for the whole page sets what each card plots,
 * so the projects compare at a glance.
 */

import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@nightshift/ui/components/card";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import {
	ToggleGroup,
	ToggleGroupItem,
} from "@nightshift/ui/components/toggle-group";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { NightRange } from "@/shared/api";
import { useNow } from "@/shared/format";
import { PageHeading } from "@/shared/page";
import { METRICS, type Metric } from "../metrics";
import { RangeBar } from "../range-bar";
import {
	changeOf,
	type ProjectNumbers,
	Sparkline,
	type useHomeData,
} from "./home-data";
import { HomeDetails, HomeNow, LastRunsStrip, lastRunsOf } from "./home-parts";

type Data = ReturnType<typeof useHomeData>;

export function VariantSideBySide({
	data,
	range,
	onRangeChange,
}: {
	data: Data;
	range: NightRange;
	onRangeChange: (range: NightRange) => void;
}) {
	const [metric, setMetric] = useState<Metric>("runs");
	const [details, setDetails] = useState<{ metric: Metric; open: boolean }>();
	const { metrics } = data;
	// The busiest project first.
	const projects = [...data.perProject].sort(
		(a, b) => (b.metrics?.values.runs ?? 0) - (a.metrics?.values.runs ?? 0),
	);

	return (
		<>
			<PageHeading
				title="Tonight"
				description="Your projects side by side, against the nights before."
			/>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<RangeBar value={range} onValueChange={onRangeChange} />
				<ToggleGroup
					variant="outline"
					size="sm"
					spacing={0}
					aria-label="Number to plot"
					value={[metric]}
					onValueChange={(next) => {
						const picked = METRICS.find((each) => each.key === next[0]);
						if (picked) setMetric(picked.key);
					}}
				>
					{METRICS.map((each) => (
						<ToggleGroupItem
							key={each.key}
							value={each.key}
							className="aria-pressed:bg-secondary"
						>
							<span
								className="size-2 rounded-full"
								style={{ backgroundColor: each.color }}
							/>
							{each.label}
						</ToggleGroupItem>
					))}
				</ToggleGroup>
			</div>
			<HomeNow summary={data.summary} gates={data.gates} />

			{/* The totals, as one strip: each opens its details. */}
			<Card className="py-0">
				<CardContent className="grid grid-cols-2 divide-x px-0 lg:grid-cols-4">
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
								onClick={() => setDetails({ metric: each.key, open: true })}
								className="flex items-baseline gap-2 px-4 py-3 text-left hover:bg-muted/50"
							>
								<span className="text-muted-foreground text-xs">
									{each.label}
								</span>
								<span className="font-semibold tabular-nums">
									{metrics ? each.format(metrics.values[each.key]) : "…"}
								</span>
								{change ? (
									<span className="flex items-center gap-1 text-muted-foreground text-xs [&_svg]:size-3">
										{change.icon}
										{change.short}
									</span>
								) : null}
							</button>
						);
					})}
				</CardContent>
			</Card>

			<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
				{projects.map((row) => (
					<ProjectConsole
						key={row.project.id}
						row={row}
						metric={metric}
						range={range}
					/>
				))}
			</div>

			{data.summary && details ? (
				<HomeDetails
					metric={details.metric}
					open={details.open}
					onOpenChange={(open) => setDetails({ ...details, open })}
					summary={data.summary}
					range={range}
					gates={data.gates}
				/>
			) : null}
		</>
	);
}

/** One project: the picked number large with its line, the other three small. */
function ProjectConsole({
	row,
	metric,
	range,
}: {
	row: ProjectNumbers;
	metric: Metric;
	range: NightRange;
}) {
	const now = useNow();
	const picked = METRICS.find((each) => each.key === metric) ?? METRICS[0];
	const { metrics } = row;
	const change = metrics
		? changeOf(
				metric,
				metrics.values[metric],
				metrics.before[metric],
				metrics.compared,
			)
		: undefined;

	return (
		<Card size="sm">
			<CardHeader>
				<CardTitle>
					<Link
						to="/projects/$projectId"
						params={{ projectId: row.project.id }}
						search={{ range }}
						className="hover:underline"
					>
						{row.project.name}
					</Link>
				</CardTitle>
				<CardDescription>
					<LastRunsStrip runs={lastRunsOf(row.nights, 8)} now={now} oneLine />
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-2">
				<div className="flex items-baseline justify-between gap-2">
					<span className="font-semibold text-3xl tabular-nums tracking-tight">
						{metrics ? picked.format(metrics.values[metric]) : "…"}
					</span>
					{change ? (
						<span className="flex items-center gap-1 text-muted-foreground text-xs [&_svg]:size-3">
							{change.icon}
							{change.short}
						</span>
					) : null}
				</div>
				{metrics ? (
					<Sparkline
						rows={metrics.rows}
						metric={metric}
						color={picked.color}
						compared={metrics.compared}
						className="h-16 w-full"
					/>
				) : (
					<Skeleton className="h-16 w-full" />
				)}
			</CardContent>
			<CardFooter className="grid grid-cols-3 gap-2 text-xs">
				{METRICS.filter((each) => each.key !== metric).map((each) => (
					<div key={each.key} className="flex flex-col">
						<span className="text-muted-foreground">{each.label}</span>
						<span className="font-medium tabular-nums">
							{metrics ? each.format(metrics.values[each.key]) : "…"}
						</span>
					</div>
				))}
			</CardFooter>
		</Card>
	);
}
