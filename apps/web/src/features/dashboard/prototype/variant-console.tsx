/**
 * PROTOTYPE, throw away. Variant B, "Console": the Performance page of Google
 * Search Console, for nights. The page-wide range on top, four metric tiles
 * you switch on and off, one large chart of the ones that are on, and one
 * tabbed table under it.
 */

import { Button } from "@nightshift/ui/components/button";
import { Card, CardContent } from "@nightshift/ui/components/card";
import {
	type ChartConfig,
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
} from "@nightshift/ui/components/chart";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { Toggle } from "@nightshift/ui/components/toggle";
import { Link } from "@tanstack/react-router";
import {
	ArrowUpRightIcon,
	CheckSquareIcon,
	HourglassIcon,
	LoaderCircleIcon,
	MinusIcon,
	SquareIcon,
	TrendingDownIcon,
	TrendingUpIcon,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { useOpenGates } from "@/features/gates";
import type { DashboardSummary, Project } from "@/shared/api";
import { formatCost, formatTime } from "@/shared/format";
import { GatesDialog } from "../gates-dialog";
import { formatNight, formatNightShort } from "../nights";
import type { VariantProps } from "../project-dashboard-page";
import { nightsOf } from "../ranges";
import { RunsDialog } from "../runs-dialog";
import { SpendDialog } from "../spend-dialog";
import { type DashboardRange, RangeBar, useDashboardRange } from "./range-bar";
import { ConsoleTables } from "./variant-console-tables";
import { Guards, HotSpots, Money, Outcomes } from "./variant-observatory";

type Metric = "runs" | "finished" | "spend" | "gates";

const METRICS: {
	key: Metric;
	label: string;
	color: string;
	format: (value: number | null) => string;
}[] = [
	{
		key: "runs",
		label: "Runs",
		color: "var(--chart-2)",
		format: (value) => String(value ?? 0),
	},
	{
		key: "finished",
		label: "Finished",
		color: "var(--status-finished)",
		format: (value) => (value === null ? "—" : `${value}%`),
	},
	{
		key: "spend",
		label: "Spend",
		color: "var(--status-sleeping)",
		format: (value) => formatCost(value ?? 0),
	},
	{
		key: "gates",
		label: "Gates asked",
		color: "var(--status-waiting)",
		format: (value) => String(value ?? 0),
	},
];

const CHART_CONFIG = Object.fromEntries(
	METRICS.flatMap(({ key, label, color }) => [
		[key, { label, color }],
		[`prev_${key}`, { label: `${label}, nights before`, color }],
	]),
) satisfies ChartConfig;

type Totals = Record<Metric, number | null>;
type Row = { label: string; title: string } & Totals &
	Partial<Record<`prev_${Metric}`, number | null>>;

const sum = (counts: Record<string, number>) =>
	Object.values(counts).reduce((total, value) => total + value, 0);

/** Finished out of the runs that ended, in whole percent. */
const rate = (finished: number, failed: number) =>
	finished + failed === 0
		? null
		: Math.round((finished / (finished + failed)) * 100);

type Night = { night: number; counts: Record<string, number> };

/** One row per night from the per-night counts of a range. */
function nightRows(runs: Night[], spend: Night[], gates: Night[]): Totals[] {
	return runs.map((night, index) => ({
		runs: sum(night.counts),
		finished: rate(night.counts.finished ?? 0, night.counts.failed ?? 0),
		spend: Math.round(sum(spend[index]?.counts ?? {}) * 100) / 100,
		gates: sum(gates[index]?.counts ?? {}),
	}));
}

function totalsOf(rows: Totals[], runs: Night[]): Totals {
	const finished = runs.reduce((t, n) => t + (n.counts.finished ?? 0), 0);
	const failed = runs.reduce((t, n) => t + (n.counts.failed ?? 0), 0);
	return {
		runs: rows.reduce((t, row) => t + (row.runs ?? 0), 0),
		finished: rate(finished, failed),
		spend: rows.reduce((t, row) => t + (row.spend ?? 0), 0),
		gates: rows.reduce((t, row) => t + (row.gates ?? 0), 0),
	};
}

/** The chart rows, the totals, and the totals of the nights before (when known). */
function seriesOf(
	summary: DashboardSummary,
	range: DashboardRange,
): { rows: Row[]; totals: Totals; before: Totals | null } {
	if (range === "24h") {
		const { hours, lastDay, dayBefore } = summary.cards;
		const rows = hours.map((hour) => ({
			label: formatTime(hour.hour),
			title: formatTime(hour.hour),
			runs: hour.finished + hour.failed + hour.other,
			finished: rate(hour.finished, hour.failed),
			spend: Math.round(hour.costUsd * 100) / 100,
			gates: hour.gates,
		}));
		return {
			rows,
			totals: {
				runs: lastDay.runs,
				finished: rate(lastDay.finished, lastDay.failed),
				spend: lastDay.cost.costUsd,
				gates: rows.reduce((t, row) => t + row.gates, 0),
			},
			before: {
				runs: dayBefore.runs,
				finished: rate(dayBefore.finished, dayBefore.failed),
				spend: dayBefore.cost.costUsd,
				gates: null,
			},
		};
	}

	const now = nightsOf(summary, range);
	const current = nightRows(
		now.runs.perNight,
		now.spend.perNight,
		now.gates.perNight,
	);
	// The nights before come from the longer range: 7 from 30, 30 from 90.
	const longer = range === 7 ? 30 : range === 30 ? 90 : null;
	let previous: Totals[] | null = null;
	let previousRuns: Night[] = [];
	if (longer) {
		const wide = nightsOf(summary, longer);
		const slice = <T,>(list: T[]) => list.slice(-2 * range, -range);
		previousRuns = slice(wide.runs.perNight);
		previous = nightRows(
			previousRuns,
			slice(wide.spend.perNight),
			slice(wide.gates.perNight),
		);
	}

	const rows = now.runs.perNight.map(({ night }, index) => {
		const row: Row = {
			label: formatNightShort(night),
			title: formatNight(night),
			...(current[index] as Totals),
		};
		const before = previous?.[index];
		if (before) {
			for (const { key } of METRICS) row[`prev_${key}`] = before[key];
		}
		return row;
	});
	return {
		rows,
		totals: totalsOf(current, now.runs.perNight),
		before: previous ? totalsOf(previous, previousRuns) : null,
	};
}

export function VariantConsole({ project, summary, isLoading }: VariantProps) {
	const { range } = useDashboardRange();
	const [on, setOn] = useState<Metric[]>(["runs", "finished"]);
	// The name stays while the dialog closes, so its body does not go blank.
	const [details, setDetails] = useState<{ metric: Metric; open: boolean }>();
	const series = summary ? seriesOf(summary, range) : null;

	return (
		<div className="flex flex-col gap-4">
			<RangeBar />
			<NowStrip projectId={project.id} summary={summary} />
			<MetricTiles
				totals={series?.totals}
				before={series?.before ?? null}
				on={on}
				onChange={setOn}
				onDetails={(metric) => setDetails({ metric, open: true })}
				loading={isLoading}
			/>
			<Card>
				<CardContent>
					{series ? (
						<ConsoleChart rows={series.rows} on={on} />
					) : (
						<Skeleton className="h-72 w-full" />
					)}
				</CardContent>
			</Card>
			<ConsoleTables project={project} summary={summary} range={range} />
			{summary && details ? (
				<MetricDetails
					metric={details.metric}
					open={details.open}
					onOpenChange={(open) => setDetails({ ...details, open })}
					project={project}
					summary={summary}
					range={range}
				/>
			) : null}
		</div>
	);
}

/** Running now and waiting for you, only when there is something. */
function NowStrip({
	projectId,
	summary,
}: {
	projectId: string;
	summary: DashboardSummary | undefined;
}) {
	const gates = useOpenGates();
	const waiting =
		gates.data?.filter((gate) => gate.projectId === projectId).length ?? 0;
	const running = summary?.cards.running ?? 0;
	const nextWake = summary?.cards.nextWakeAt ?? null;
	if (running === 0 && waiting === 0) return null;

	return (
		<div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg border bg-muted/40 px-4 py-2 text-sm">
			{running > 0 ? (
				<Link
					to="/projects/$projectId/runs"
					params={{ projectId }}
					className="flex items-center gap-2 hover:underline"
				>
					<LoaderCircleIcon className="size-4 animate-spin text-status-running" />
					{running} running now
				</Link>
			) : null}
			{waiting > 0 ? (
				<Link to="/inbox" className="flex items-center gap-2 hover:underline">
					<HourglassIcon className="size-4 text-status-waiting" />
					{waiting} {waiting === 1 ? "Gate waits" : "Gates wait"} for you
				</Link>
			) : null}
			{nextWake ? (
				<span className="text-muted-foreground">
					Next wake-up {formatTime(nextWake)}
				</span>
			) : null}
		</div>
	);
}

function MetricTiles({
	totals,
	before,
	on,
	onChange,
	onDetails,
	loading,
}: {
	totals: Totals | undefined;
	/** Null when the numbers do not reach back that far: 90 nights. */
	before: Totals | null;
	on: Metric[];
	onChange: (on: Metric[]) => void;
	onDetails: (metric: Metric) => void;
	loading: boolean;
}) {
	return (
		<div className="grid grid-cols-2 overflow-hidden rounded-xl border lg:grid-cols-4">
			{METRICS.map((metric) => {
				const pressed = on.includes(metric.key);
				const value = totals?.[metric.key] ?? null;
				return (
					<div
						key={metric.key}
						className="relative flex border-r last:border-r-0 data-pressed:text-background"
						data-pressed={pressed ? "" : undefined}
						style={pressed ? { backgroundColor: metric.color } : undefined}
					>
						<Toggle
							pressed={pressed}
							onPressedChange={(next) =>
								onChange(
									next
										? [...on, metric.key]
										: on.filter((key) => key !== metric.key),
								)
							}
							className="h-auto w-full flex-col items-start justify-start gap-3 rounded-none p-4 text-left text-inherit hover:bg-transparent aria-pressed:bg-transparent aria-pressed:text-inherit"
						>
							<span className="flex items-center gap-2 font-medium text-sm">
								{pressed ? <CheckSquareIcon /> : <SquareIcon />}
								{metric.label}
							</span>
							{loading || !totals ? (
								<Skeleton className="h-9 w-20" />
							) : (
								<span className="font-semibold text-4xl tabular-nums tracking-tight">
									{metric.format(value)}
								</span>
							)}
							<Change
								metric={metric.key}
								value={value}
								before={before ? before[metric.key] : undefined}
							/>
						</Toggle>
						<Button
							variant="ghost"
							size="xs"
							className="absolute top-3 right-3 text-inherit hover:bg-foreground/10 hover:text-inherit"
							onClick={() => onDetails(metric.key)}
						>
							Details
							<ArrowUpRightIcon data-icon="inline-end" />
						</Button>
					</div>
				);
			})}
		</div>
	);
}

/**
 * How a number moved against the period before. Always shown: "undefined"
 * when the numbers do not reach back that far, null when nothing ended then.
 */
function Change({
	metric,
	value,
	before,
}: {
	metric: Metric;
	value: number | null;
	before: number | null | undefined;
}) {
	const line = (icon: ReactNode, text: string) => (
		<span className="flex items-center gap-1 text-xs opacity-80">
			{icon}
			{text}
		</span>
	);
	if (before === undefined)
		return line(<MinusIcon />, "Nothing to compare with yet");
	if (value === null || before === null)
		return line(<MinusIcon />, "No runs ended in the period before");
	if (before === 0 && value > 0)
		return line(<TrendingUpIcon />, "None in the period before");
	const delta = value - before;
	if (delta === 0) return line(<MinusIcon />, "Same as the period before");
	const amount =
		metric === "spend"
			? formatCost(Math.abs(delta))
			: metric === "finished"
				? `${Math.abs(delta)} points`
				: String(Math.abs(delta));
	return line(
		delta > 0 ? <TrendingUpIcon /> : <TrendingDownIcon />,
		`${amount} ${delta > 0 ? "more" : "less"} than the period before`,
	);
}

/**
 * The details of a number, in the dialog the cards open now, at the page's
 * range. Tabs for telemetry to come (sample data) sit beside the real ones.
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
	range: DashboardRange;
}) {
	const gates = useOpenGates();
	const waiting =
		gates.data?.filter((gate) => gate.projectId === project.id) ?? [];
	const flows = summary.flowHealth?.rows.map((row) => row.name) ?? [];
	const initialRange = range === "24h" ? 7 : range;
	const props = { open, onOpenChange, summary, project };

	if (metric === "spend") {
		return (
			<SpendDialog
				{...props}
				extras={{
					initialRange,
					extraTabs: [
						{
							value: "models",
							label: "By model",
							content: <Money summary={summary} range={range} />,
						},
						{
							value: "budgets",
							label: "Budgets",
							content: <Guards summary={summary} flows={flows} range={range} />,
						},
					],
				}}
			/>
		);
	}
	if (metric === "gates") {
		return (
			<GatesDialog
				{...props}
				gates={waiting}
				extras={{
					initialRange,
					extraTabs: [
						{
							value: "scores",
							label: "Answers as scores",
							content: (
								<Outcomes summary={summary} flows={flows} range={range} />
							),
						},
					],
				}}
			/>
		);
	}
	return (
		<RunsDialog
			{...props}
			extras={{
				initialRange,
				initialTab: metric === "finished" ? "failed" : "overview",
				extraTabs: [
					{
						value: "steps",
						label: "Steps",
						content: <HotSpots flows={flows} range={range} />,
					},
					{
						value: "outcomes",
						label: "Outcomes",
						content: <Outcomes summary={summary} flows={flows} range={range} />,
					},
				],
			}}
		/>
	);
}

function ConsoleChart({ rows, on }: { rows: Row[]; on: Metric[] }) {
	if (on.length === 0) {
		return (
			<p className="flex h-72 items-center justify-center text-muted-foreground text-sm">
				Choose a number above to see it per night.
			</p>
		);
	}
	const shown = METRICS.filter((metric) => on.includes(metric.key));

	return (
		<ChartContainer config={CHART_CONFIG} className="aspect-auto h-72 w-full">
			<LineChart data={rows} margin={{ left: 4, right: 4, top: 8 }}>
				<CartesianGrid vertical={false} />
				<XAxis
					dataKey="label"
					tickLine={false}
					axisLine={false}
					tickMargin={8}
					minTickGap={24}
				/>
				{shown.map((metric, index) => (
					<YAxis
						key={metric.key}
						yAxisId={metric.key}
						orientation={index === 0 ? "left" : "right"}
						hide={index > 1}
						tickLine={false}
						axisLine={false}
						width={48}
						allowDecimals={metric.key === "spend"}
						domain={metric.key === "finished" ? [0, 100] : [0, "auto"]}
						tickFormatter={(value: number) => metric.format(value)}
					/>
				))}
				<ChartTooltip
					content={
						<ChartTooltipContent
							labelFormatter={(_, payload) =>
								(payload?.[0]?.payload as Row | undefined)?.title
							}
						/>
					}
				/>
				{shown.map((metric) => (
					<Line
						key={metric.key}
						yAxisId={metric.key}
						dataKey={metric.key}
						type="monotone"
						stroke={`var(--color-${metric.key})`}
						strokeWidth={2}
						dot={false}
						connectNulls
					/>
				))}
				{shown.map((metric) => (
					<Line
						key={`prev_${metric.key}`}
						yAxisId={metric.key}
						dataKey={`prev_${metric.key}`}
						type="monotone"
						stroke={`var(--color-${metric.key})`}
						strokeWidth={1.5}
						strokeDasharray="4 4"
						strokeOpacity={0.6}
						dot={false}
						connectNulls
					/>
				))}
			</LineChart>
		</ChartContainer>
	);
}
