/**
 * The Metrics tab of a flow's health (Q32): the numbers its steps report
 * in their data (`scores`), one metric at a time. Four stats, then the
 * metric, the spend and Needed you per day on one day axis, then every
 * metric in a table.
 */
import { Button } from "@nightshift/ui/components/button";
import {
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
} from "@nightshift/ui/components/chart";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@nightshift/ui/components/select";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import type { FlowRange } from "@/shared/api";
import { DataTable, dataTableColumns } from "@/shared/data-table";
import { formatKnownCost, formatRelative, hoverTime } from "@/shared/format";
import { LocalTime } from "@/shared/time";
import { formatDayShort, formatDayTitle } from "./days";
import { ChartSection, DetailsEmpty, Stat } from "./details";

type MetricRow = NonNullable<FlowRange["scores"]>[number];

/** A metric as a short number: whole numbers as they are, else two decimals. */
function formatMetric(value: number): string {
	return Number.isInteger(value)
		? String(value)
		: value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function FlowMetrics({
	range,
	now,
	onNavigate,
}: {
	range: FlowRange;
	now: number;
	onNavigate: () => void;
}) {
	const metrics = range.scores ?? [];
	const [picked, setPicked] = useState<string>();
	const metric =
		metrics.find((each) => each.name === picked) ?? metrics[0] ?? null;
	if (!metric) {
		return (
			<DetailsEmpty>
				No step reported a metric in the last {range.nights} days. A Command,
				Agent or Value reports one in its data, for example{" "}
				<code className="font-mono">{'{"scores": {"leads": 3}}'}</code>.
			</DetailsEmpty>
		);
	}
	const own = range.runs - range.asSubflow;
	return (
		<>
			<Select
				items={metrics.map((each) => ({ value: each.name, label: each.name }))}
				value={metric.name}
				onValueChange={(next) => {
					if (typeof next === "string") setPicked(next);
				}}
			>
				<SelectTrigger
					size="sm"
					className="w-fit min-w-48 font-mono"
					aria-label="Metric"
				>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectGroup>
						{metrics.map((each) => (
							<SelectItem
								key={each.name}
								value={each.name}
								className="font-mono"
							>
								{each.name}
							</SelectItem>
						))}
					</SelectGroup>
				</SelectContent>
			</Select>
			<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
				<Stat label="Total" value={formatMetric(metric.sum)} />
				<Stat
					label="Per run"
					value={formatMetric(metric.sum / Math.max(metric.runs, 1))}
				/>
				<Stat
					label="Latest"
					value={formatMetric(metric.latest.value)}
					hint={
						<LocalTime at={metric.latest.at}>
							{formatRelative(metric.latest.at, now)}
						</LocalTime>
					}
				/>
				<Stat
					label="Runs"
					value={String(metric.runs)}
					hint={own > 0 ? `Of ${own} ${own === 1 ? "run" : "runs"}` : undefined}
				/>
			</div>
			<MetricPerDay name={metric.name} perNight={range.perNight} />
			<MetricsTable metrics={metrics} now={now} onNavigate={onNavigate} />
		</>
	);
}

/** One small chart per series, all on the same days. */
const SERIES = {
	metric: { label: "Per run", color: "var(--chart-2)" },
	spent: { label: "Spent", color: "var(--metric-spend)" },
	needed: { label: "Needed you", color: "var(--metric-needed)" },
} as const;

type Series = keyof typeof SERIES;

/**
 * The metric per run, what the runs spent and how often they needed you,
 * per day, in three small charts on one day axis. A hover on one day
 * shows that day in all three.
 */
function MetricPerDay({
	name,
	perNight,
}: {
	name: string;
	perNight: FlowRange["perNight"];
}) {
	if (perNight.every((day) => day.spent === undefined)) {
		return (
			<DetailsEmpty>
				Update Night Shift to see your metrics per day.
			</DetailsEmpty>
		);
	}
	const rows = perNight.map((day) => {
		const metric = day.metrics?.[name];
		const needed = day.needed;
		return {
			label: formatDayShort(day.night),
			title: formatDayTitle(day.night),
			metric: metric && metric.runs > 0 ? metric.sum / metric.runs : null,
			metricSum: metric?.sum ?? 0,
			metricRuns: metric?.runs ?? 0,
			spent: day.spent?.costUsd ?? 0,
			spentCost: day.spent ?? {
				costUsd: 0,
				costEstimated: false,
				costMissing: 0,
			},
			needed:
				needed && needed.runs > 0
					? Math.round((needed.needed / needed.runs) * 100)
					: null,
			neededRuns: needed?.needed ?? 0,
			ownRuns: needed?.runs ?? 0,
		};
	});
	type Row = (typeof rows)[number];
	const charts: {
		series: Series;
		title: string;
		format: (value: number) => string;
		share?: boolean;
		detail: (row: Row) => string;
	}[] = [
		{
			series: "metric",
			title: `${name} per run`,
			format: formatMetric,
			detail: (row) =>
				`${formatMetric(row.metricSum)} from ${row.metricRuns} ${row.metricRuns === 1 ? "run" : "runs"}`,
		},
		{
			series: "spent",
			title: "Spent",
			format: (value) => `$${value.toFixed(2)}`,
			detail: (row) => formatKnownCost(row.spentCost),
		},
		{
			series: "needed",
			title: "Needed you",
			format: (value) => `${value}%`,
			share: true,
			detail: (row) =>
				`${row.neededRuns} of ${row.ownRuns} ${row.ownRuns === 1 ? "run" : "runs"}`,
		},
	];
	return (
		<ChartSection
			title="Per day"
			hint="Point at a day to see it in all three charts."
		>
			{charts.map((chart, index) => (
				<div key={chart.series} className="flex flex-col gap-1">
					<p className="text-muted-foreground text-xs">{chart.title}</p>
					<ChartContainer
						config={{ [chart.series]: SERIES[chart.series] }}
						className="aspect-auto h-24 w-full"
					>
						<BarChart
							data={rows}
							syncId="flow-metrics"
							margin={{ left: 0, right: 0, top: 4 }}
						>
							<CartesianGrid vertical={false} />
							<XAxis
								dataKey="label"
								hide={index < charts.length - 1}
								tickLine={false}
								axisLine={false}
								tickMargin={8}
								minTickGap={24}
							/>
							<YAxis
								tickLine={false}
								axisLine={false}
								width={48}
								tickCount={3}
								domain={chart.share ? [0, 100] : [0, "auto"]}
								tickFormatter={(value: number) => chart.format(value)}
							/>
							<ChartTooltip
								cursor={false}
								content={
									<ChartTooltipContent
										labelFormatter={(_, payload) =>
											String(payload[0]?.payload?.title ?? "")
										}
										formatter={(value, _, item) => (
											<div className="flex w-full items-center gap-2">
												<span className="text-muted-foreground">
													{chart.title}
												</span>
												<span className="ml-auto font-medium font-mono tabular-nums">
													{chart.format(Number(value))}
												</span>
												<span className="text-muted-foreground">
													{chart.detail(item.payload as Row)}
												</span>
											</div>
										)}
									/>
								}
							/>
							<Bar
								dataKey={chart.series}
								fill={`var(--color-${chart.series})`}
								radius={[4, 4, 0, 0]}
								maxBarSize={24}
							/>
						</BarChart>
					</ChartContainer>
				</div>
			))}
		</ChartSection>
	);
}

/**
 * Every metric the flow's runs reported, one row per name, the most runs
 * first. The caller leaves it out when no run reported one.
 */
function MetricsTable({
	metrics,
	now,
	onNavigate,
}: {
	metrics: MetricRow[];
	now: number;
	onNavigate: () => void;
}) {
	return (
		<ChartSection title="Metrics" hint="Per name, the most runs first">
			<DataTable
				columns={metricColumns(now, onNavigate)}
				data={metrics}
				getRowId={(row) => row.name}
			/>
		</ChartSection>
	);
}

const metricColumn = dataTableColumns<MetricRow>();

function metricColumns(now: number, onNavigate: () => void) {
	const number = {
		headClassName: "text-right w-20",
		cellClassName: "text-right tabular-nums",
	};
	return metricColumn.columns([
		metricColumn.accessor("name", {
			header: "Metric",
			cell: ({ getValue }) => (
				<span className="font-mono text-xs">{getValue()}</span>
			),
		}),
		metricColumn.accessor("runs", {
			header: "Runs",
			enableSorting: true,
			meta: number,
		}),
		metricColumn.accessor("sum", {
			header: "Total",
			enableSorting: true,
			cell: ({ getValue }) => formatMetric(getValue()),
			meta: number,
		}),
		metricColumn.accessor("mean", {
			header: "Average",
			enableSorting: true,
			cell: ({ getValue }) => formatMetric(getValue()),
			meta: number,
		}),
		metricColumn.accessor((row) => row.latest.at, {
			id: "latest",
			header: "Latest",
			enableSorting: true,
			cell: ({ row: { original } }) => (
				<span className="flex items-center gap-2">
					<span className="tabular-nums">
						{formatMetric(original.latest.value)}
					</span>
					<Button
						variant="link"
						size="xs"
						className="h-auto px-0 font-normal text-muted-foreground"
						nativeButton={false}
						aria-label={`Open run, reported ${hoverTime(original.latest.at)}`}
						render={
							<Link
								to="/runs/$runId"
								params={{ runId: original.latest.runId }}
								onClick={onNavigate}
							/>
						}
					>
						<LocalTime at={original.latest.at}>
							{formatRelative(original.latest.at, now)}
						</LocalTime>
					</Button>
				</span>
			),
			meta: { headClassName: "w-44" },
		}),
	]);
}
