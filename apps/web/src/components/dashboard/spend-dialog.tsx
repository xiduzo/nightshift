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
import { Link } from "@tanstack/react-router";
import { ArrowRightIcon, CoinsIcon } from "lucide-react";
import { useId, useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { DataTable, dataTableColumns } from "@/components/data-table";
import { RunStatusBadge } from "@/components/run-status-badge";
import { useNow } from "@/hooks/use-now";
import type { Project, RunSummary } from "@/lib/api-types";
import { formatCost, formatRelative } from "@/lib/format";

import {
	ChartSection,
	DetailsDialog,
	DetailsEmpty,
	DetailsHeader,
	RangeToggle,
	Stat,
	Swatch,
} from "./details";
import { spendGroupOf, spendPerNight } from "./spend";

const DAY_MS = 24 * 60 * 60 * 1000;
const RANGES = [7, 30, 90] as const;
type Range = (typeof RANGES)[number];

/**
 * What runs cost, in detail: tonight, averages, spend per night stacked by
 * flow (or by project over all of them), and the most expensive runs. After
 * the details dialog of a Home Assistant sensor.
 */
export function SpendDialog({
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
			<SpendDetails
				runs={runs}
				project={project}
				projects={projects}
				onNavigate={() => onOpenChange(false)}
			/>
		</DetailsDialog>
	);
}

function SpendDetails({
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
	const history = spendPerNight(runs, range, groupOf, now);
	const month = spendPerNight(runs, 30, groupOf, now);
	const week = spendPerNight(runs, 7, groupOf, now);
	const lastDay = runs.filter((run) => run.createdAt >= now - DAY_MS);
	const spentLastDay = lastDay.reduce((sum, run) => sum + run.costUsd, 0);
	const latest = lastDay.reduce<number | null>(
		(last, run) =>
			last === null || run.createdAt > last ? run.createdAt : last,
		null,
	);
	const priciest = history.inRange
		.slice()
		.sort((a, b) => b.costUsd - a.costUsd)
		.slice(0, 3);

	return (
		<>
			<DetailsHeader project={project} trail="Runs" title="Spend" />

			<Item variant="muted" size="sm">
				<ItemMedia variant="icon">
					<CoinsIcon />
				</ItemMedia>
				<ItemContent>
					<ItemTitle>Spent, last 24 h</ItemTitle>
					<ItemDescription>
						{lastDay.length === 0
							? "No runs in the last day"
							: `${lastDay.length} ${lastDay.length === 1 ? "run" : "runs"}, the last ${latest ? formatRelative(latest, now) : ""}`}
					</ItemDescription>
				</ItemContent>
				<ItemActions className="font-semibold text-lg tabular-nums">
					{formatCost(spentLastDay)}
				</ItemActions>
			</Item>

			<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
				<Stat label="Last 7 nights" value={formatCost(week.total)} />
				<Stat label="Last 30 nights" value={formatCost(month.total)} />
				<Stat
					label="Per run"
					value={
						month.inRange.length > 0
							? formatCost(month.total / month.inRange.length)
							: "—"
					}
					hint="Average, 30 nights"
				/>
				<Stat
					label="Per night"
					value={
						month.nightsWithRuns > 0
							? formatCost(month.total / month.nightsWithRuns)
							: "—"
					}
					hint="Nights with runs"
				/>
			</div>

			<ChartSection
				title="History"
				hint={`Per night, noon to noon, by ${project ? "flow" : "project"}`}
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
				{history.total === 0 ? (
					<DetailsEmpty>No spend in the last {range} nights.</DetailsEmpty>
				) : (
					<ChartContainer
						config={history.config}
						className="aspect-auto h-56 w-full"
					>
						<BarChart data={history.rows} margin={{ left: 0, right: 0 }}>
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
								width={48}
								tickFormatter={(value: number) => `$${value.toFixed(2)}`}
							/>
							<ChartTooltip
								cursor={false}
								content={
									<ChartTooltipContent
										labelKey="title"
										labelFormatter={(_, payload) =>
											String(payload[0]?.payload?.title ?? "")
										}
										formatter={(value, name) => (
											<div className="flex w-full items-center gap-2">
												<Swatch color={`var(--color-${name})`} />
												<span className="text-muted-foreground">
													{history.config[name as string]?.label ?? name}
												</span>
												<span className="ml-auto font-medium font-mono tabular-nums">
													{formatCost(Number(value))}
												</span>
											</div>
										)}
									/>
								}
							/>
							{history.groups.map((group, index) => (
								<Bar
									key={group.key}
									dataKey={group.key}
									stackId="spend"
									fill={`var(--color-${group.key})`}
									radius={
										index === history.groups.length - 1
											? [4, 4, 0, 0]
											: [0, 0, 0, 0]
									}
								/>
							))}
						</BarChart>
					</ChartContainer>
				)}
			</ChartSection>

			{history.groups.length > 0 ? (
				<DataTable
					columns={spendColumns(project ? "Flow" : "Project", history.total)}
					data={history.groups.map((group) => ({
						...group,
						color: history.config[group.key]?.color,
					}))}
					getRowId={(group) => group.key}
				/>
			) : null}

			{priciest.length > 0 ? (
				<section
					aria-labelledby={`${id}-priciest`}
					className="flex flex-col gap-2"
				>
					<h3 id={`${id}-priciest`} className="font-medium text-base">
						Most expensive runs
					</h3>
					<ItemGroup className="gap-1">
						{priciest.map((run) => (
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
									<ItemDescription>
										{project ? null : `${groupOf(run)}, `}
										{formatRelative(run.createdAt, now)}
									</ItemDescription>
								</ItemContent>
								<ItemActions>
									<RunStatusBadge status={run.status} />
									<span className="w-20 text-right font-medium tabular-nums">
										{formatCost(run.costUsd)}
									</span>
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

type SpendRow = {
	key: string;
	label: string;
	color: string | undefined;
	runs: number;
	total: number;
};

const spendColumn = dataTableColumns<SpendRow>();

/** Spend per flow or project: runs, cost per run, share and total. */
function spendColumns(groupLabel: string, total: number) {
	return spendColumn.columns([
		spendColumn.accessor("label", {
			header: groupLabel,
			cell: ({ row }) => (
				<span className="flex min-w-0 items-center gap-2">
					<Swatch color={row.original.color} />
					<span className="truncate font-mono text-xs">
						{row.original.label}
					</span>
				</span>
			),
		}),
		spendColumn.accessor("runs", {
			header: "Runs",
			enableSorting: true,
			meta: {
				headClassName: "text-right",
				cellClassName: "text-right tabular-nums",
			},
		}),
		spendColumn.accessor((group) => group.total / group.runs, {
			id: "perRun",
			header: "Per run",
			enableSorting: true,
			cell: ({ getValue }) => formatCost(getValue()),
			meta: {
				headClassName: "text-right",
				cellClassName: "text-right tabular-nums",
			},
		}),
		spendColumn.accessor((group) => (total > 0 ? group.total / total : 0), {
			id: "share",
			header: "Share",
			enableSorting: true,
			cell: ({ getValue }) =>
				total > 0 ? `${Math.round(getValue() * 100)}%` : "—",
			meta: {
				headClassName: "text-right",
				cellClassName: "text-right text-muted-foreground tabular-nums",
			},
		}),
		spendColumn.accessor("total", {
			header: "Total",
			enableSorting: true,
			cell: ({ row }) => formatCost(row.original.total),
			meta: {
				headClassName: "text-right",
				cellClassName: "text-right font-medium tabular-nums",
			},
		}),
	]);
}
