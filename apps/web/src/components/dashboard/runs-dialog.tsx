import { Button } from "@nightshift/ui/components/button";
import {
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
} from "@nightshift/ui/components/chart";
import { DialogFooter } from "@nightshift/ui/components/dialog";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from "@nightshift/ui/components/item";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@nightshift/ui/components/table";
import { Link } from "@tanstack/react-router";
import { ArrowRightIcon, HistoryIcon } from "lucide-react";
import { useId, useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { RunStatusBadge } from "@/components/run-status-badge";
import { countRunStatuses, RUN_STATUS_CHART } from "@/components/runs-donut";
import { useNow } from "@/hooks/use-now";
import type { Project, RunStatus, RunSummary } from "@/lib/api-types";
import { formatRelative } from "@/lib/format";
import {
	formatNight,
	formatNightShort,
	inLastNights,
	lastNights,
	nightOf,
} from "@/lib/nights";

import {
	ChartSection,
	DetailsDialog,
	DetailsEmpty,
	DetailsHeader,
	RangeToggle,
	Stat,
	Swatch,
} from "./details";
import { spendGroupOf } from "./spend";

const DAY_MS = 24 * 60 * 60 * 1000;
const RANGES = [7, 30, 90] as const;
type Range = (typeof RANGES)[number];
/** Failures listed under the table. */
const FAILURES_MAX = 3;

/**
 * How runs went, in detail: runs per night stacked by status, the share that
 * finished per flow (or per project over all of them), and the latest
 * failures. Behind the "Runs, last 24 h" card.
 */
export function RunsDialog({
	open,
	onOpenChange,
	runs,
	project,
	projects,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	runs: RunSummary[];
	/** One project; otherwise all of them. */
	project?: Project;
	/** To name the project of each run, over all projects. */
	projects?: Project[];
}) {
	return (
		<DetailsDialog open={open} onOpenChange={onOpenChange}>
			<RunsDetails
				runs={runs}
				project={project}
				projects={projects}
				onNavigate={() => onOpenChange(false)}
			/>
		</DetailsDialog>
	);
}

function RunsDetails({
	runs,
	project,
	projects,
	onNavigate,
}: {
	runs: RunSummary[];
	project?: Project;
	projects?: Project[];
	onNavigate: () => void;
}) {
	const id = useId();
	const now = useNow(60_000);
	const [range, setRange] = useState<Range>(30);
	const groupOf = spendGroupOf(project, projects);
	const lastDay = runs.filter((run) => run.createdAt >= now - DAY_MS);
	const inRange = runs.filter((run) => inLastNights(run.createdAt, range, now));
	const week = runs.filter((run) => inLastNights(run.createdAt, 7, now));
	const month = runs.filter((run) => inLastNights(run.createdAt, 30, now));
	const ended = month.filter(
		(run) => run.status === "finished" || run.status === "failed",
	);
	const monthFinished = ended.filter((run) => run.status === "finished");
	const monthNights = new Set(month.map((run) => nightOf(run.createdAt))).size;

	// Only the statuses that occur, in the donut's order: live first.
	const statuses = countRunStatuses(inRange).map(({ status }) => status);
	const rows = lastNights(range, now).map((night) => {
		const row: Record<string, number | string> = {
			label: formatNightShort(night),
			title: formatNight(night),
		};
		for (const status of statuses) row[status] = 0;
		for (const run of inRange) {
			if (nightOf(run.createdAt) === night) {
				row[run.status] = (row[run.status] as number) + 1;
			}
		}
		return row;
	});
	const config = Object.fromEntries(
		statuses.map((status) => [status, RUN_STATUS_CHART[status]]),
	);

	const byGroup = new Map<string, RunSummary[]>();
	for (const run of inRange) {
		byGroup.set(groupOf(run), [...(byGroup.get(groupOf(run)) ?? []), run]);
	}
	const groups = [...byGroup.entries()]
		.map(([label, ofGroup]) => ({
			label,
			runs: ofGroup.length,
			finished: ofGroup.filter((run) => run.status === "finished").length,
			failed: ofGroup.filter((run) => run.status === "failed").length,
		}))
		.sort((a, b) => b.runs - a.runs);
	const failures = inRange
		.filter((run) => run.status === "failed")
		.sort((a, b) => b.createdAt - a.createdAt)
		.slice(0, FAILURES_MAX);
	const lastDayFinished = lastDay.filter(
		(run) => run.status === "finished",
	).length;
	const lastDayFailed = lastDay.filter((run) => run.status === "failed").length;

	return (
		<>
			<DetailsHeader project={project} trail="Runs" title="Runs" />

			<Item variant="muted" size="sm">
				<ItemMedia variant="icon">
					<HistoryIcon />
				</ItemMedia>
				<ItemContent>
					<ItemTitle>Runs, last 24 h</ItemTitle>
					<ItemDescription>
						{lastDay.length === 0
							? "No runs in the last day"
							: `${lastDayFinished} finished, ${lastDayFailed} failed`}
					</ItemDescription>
				</ItemContent>
				<ItemActions className="font-semibold text-lg tabular-nums">
					{lastDay.length}
				</ItemActions>
			</Item>

			<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
				<Stat label="Last 7 nights" value={String(week.length)} />
				<Stat label="Last 30 nights" value={String(month.length)} />
				<Stat
					label="Finished"
					value={
						ended.length > 0
							? `${Math.round((monthFinished.length / ended.length) * 100)}%`
							: "—"
					}
					hint="Of ended runs, 30 nights"
				/>
				<Stat
					label="Per night"
					value={
						monthNights > 0 ? (month.length / monthNights).toFixed(1) : "—"
					}
					hint="Nights with runs"
				/>
			</div>

			<ChartSection
				title="History"
				hint="Runs per night, noon to noon, by status"
				toggle={
					<RangeToggle
						ranges={RANGES}
						value={range}
						onValueChange={setRange}
						short={(nights) => `${nights}n`}
						long={(nights) => `Last ${nights} nights`}
					/>
				}
			>
				{inRange.length === 0 ? (
					<DetailsEmpty>No runs in the last {range} nights.</DetailsEmpty>
				) : (
					<ChartContainer config={config} className="aspect-auto h-56 w-full">
						<BarChart data={rows} margin={{ left: 0, right: 0 }}>
							<CartesianGrid vertical={false} />
							<XAxis
								dataKey="label"
								tickLine={false}
								axisLine={false}
								tickMargin={8}
								minTickGap={24}
							/>
							<YAxis
								tickLine={false}
								axisLine={false}
								width={32}
								allowDecimals={false}
							/>
							<ChartTooltip
								cursor={false}
								content={
									<ChartTooltipContent
										labelFormatter={(_, payload) =>
											String(payload[0]?.payload?.title ?? "")
										}
										formatter={(value, name) => (
											<div className="flex w-full items-center gap-2">
												<Swatch color={`var(--color-${name})`} />
												<span className="text-muted-foreground">
													{RUN_STATUS_CHART[name as RunStatus]?.label ?? name}
												</span>
												<span className="ml-auto font-medium font-mono tabular-nums">
													{Number(value)}
												</span>
											</div>
										)}
									/>
								}
							/>
							{statuses.map((status, index) => (
								<Bar
									key={status}
									dataKey={status}
									stackId="runs"
									fill={`var(--color-${status})`}
									radius={
										index === statuses.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]
									}
								/>
							))}
						</BarChart>
					</ChartContainer>
				)}
			</ChartSection>

			{groups.length > 0 ? (
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>{project ? "Flow" : "Project"}</TableHead>
							<TableHead className="text-right">Runs</TableHead>
							<TableHead className="text-right">Finished</TableHead>
							<TableHead className="text-right">Failed</TableHead>
							<TableHead className="text-right">Finished share</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{groups.map((group) => (
							<TableRow key={group.label}>
								<TableCell className="max-w-48 truncate font-mono text-xs">
									{group.label}
								</TableCell>
								<TableCell className="text-right tabular-nums">
									{group.runs}
								</TableCell>
								<TableCell className="text-right tabular-nums">
									{group.finished}
								</TableCell>
								<TableCell className="text-right tabular-nums">
									{group.failed}
								</TableCell>
								<TableCell className="text-right font-medium tabular-nums">
									{`${Math.round((group.finished / group.runs) * 100)}%`}
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			) : null}

			{failures.length > 0 ? (
				<section
					aria-labelledby={`${id}-failures`}
					className="flex flex-col gap-2"
				>
					<h3 id={`${id}-failures`} className="font-medium text-base">
						Latest failures
					</h3>
					<ItemGroup className="gap-1">
						{failures.map((run) => (
							<Item
								key={run.id}
								size="xs"
								render={
									<Link
										to="/runs/$runId"
										params={{ runId: run.id }}
										onClick={onNavigate}
									/>
								}
							>
								<ItemContent className="min-w-0">
									<ItemTitle className="w-full truncate">{run.title}</ItemTitle>
									<ItemDescription className="truncate">
										{project ? null : `${groupOf(run)}, `}
										{formatRelative(run.createdAt, now)}
										{run.reason ? `: ${run.reason}` : null}
									</ItemDescription>
								</ItemContent>
								<ItemActions>
									<RunStatusBadge status={run.status} />
								</ItemActions>
							</Item>
						))}
					</ItemGroup>
				</section>
			) : null}

			{project ? (
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
						<ArrowRightIcon data-icon="inline-end" />
					</Button>
				</DialogFooter>
			) : null}
		</>
	);
}
