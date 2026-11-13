import {
	type ChangeMeasure,
	type ChangeTrend,
	type FlowChanges,
	verdictLabel,
} from "@nightshift/client";
import { Badge } from "@nightshift/ui/components/badge";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@nightshift/ui/components/table";
import { cn } from "@nightshift/ui/lib/utils";
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import { formatCost, formatDuration, formatRelative } from "@/shared/format";

type Comparison = FlowChanges["days"];
type Trends = Comparison["trends"];

/** One row of the table: a number of each column, and how it moved. */
type Row = {
	label: string;
	value: (measure: ChangeMeasure) => number | null;
	show: (value: number) => string;
	trend?: keyof Trends;
};

const ROWS: Row[] = [
	{ label: "Runs", value: (m) => m.runs, show: String },
	{
		label: "Finished",
		value: (m) => (m.runs > 0 ? m.finished / m.runs : null),
		show: (v) => `${Math.round(v * 100)}%`,
		trend: "finished",
	},
	{
		label: "Needed you without a plan",
		value: (m) => m.unplanned,
		show: (v) => `${v.toFixed(1)} a run`,
		trend: "unplanned",
	},
	{
		label: "Waited for you",
		value: (m) => m.waitMs,
		show: (v) => (v > 0 ? `${formatDuration(v)} a run` : "—"),
		trend: "waitMs",
	},
	{
		label: "Work time",
		value: (m) => m.workMs,
		show: (v) => formatDuration(v),
		trend: "workMs",
	},
	{
		label: "Cost",
		value: (m) => m.costUsd,
		show: (v) => formatCost(v),
		trend: "costUsd",
	},
];

/** What came out: pull requests merged, and runs found useful. */
function results(measure: ChangeMeasure): string {
	const parts = [
		measure.merged + measure.closed > 0
			? `${measure.merged} of ${measure.merged + measure.closed} merged`
			: "",
		measure.rated > 0 ? `${measure.useful} of ${measure.rated} useful` : "",
	].filter(Boolean);
	return parts.length > 0 ? parts.join(" · ") : "—";
}

function Verdict({ comparison }: { comparison: Comparison }) {
	const { verdict } = comparison;
	return (
		<Badge
			variant={
				verdict === "worse"
					? "destructive"
					: verdict === "better"
						? "secondary"
						: "outline"
			}
		>
			{verdictLabel(verdict)}
		</Badge>
	);
}

/** An arrow when a number moved by 10% or more: green when better, red when worse. */
function TrendArrow({
	trend,
	after,
	before,
}: {
	trend: ChangeTrend;
	after: number | null;
	before: number | null;
}) {
	if (trend === "same" || after === null || before === null) return null;
	const Icon = after > before ? ArrowUpIcon : ArrowDownIcon;
	return (
		<Icon
			className={cn(
				"size-3.5",
				trend === "better" ? "text-status-finished" : "text-status-failed",
			)}
			aria-label={trend === "better" ? "Better" : "Worse"}
		/>
	);
}

/**
 * One table, two comparisons: the runs before and since your last change,
 * then the days before the range and the range. The newer value of each
 * pair carries the arrow.
 */
export function BeforeAfter({
	changes,
	now,
}: {
	changes: FlowChanges;
	now: number;
}) {
	const { lastChange, days, nights } = changes;
	const pairs = [
		{ key: "change", comparison: lastChange },
		{ key: "days", comparison: days },
	];
	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead />
					<TableHead colSpan={2} className="border-l">
						<span className="flex items-center gap-2">
							{lastChange
								? `Your last change, ${formatRelative(lastChange.change.at, now)}`
								: "No change in these days"}
							{lastChange ? <Verdict comparison={lastChange} /> : null}
						</span>
					</TableHead>
					<TableHead colSpan={2} className="border-l">
						<span className="flex items-center gap-2">
							The last {nights} days
							<Verdict comparison={days} />
						</span>
					</TableHead>
				</TableRow>
				<TableRow>
					<TableHead />
					<TableHead className="border-l text-right">
						{lastChange ? `${lastChange.before.runs} runs before` : ""}
					</TableHead>
					<TableHead className="text-right">
						{lastChange ? `${lastChange.after.runs} since` : ""}
					</TableHead>
					<TableHead className="border-l text-right">
						{nights} days before
					</TableHead>
					<TableHead className="text-right">Last {nights} days</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody className="tabular-nums">
				{ROWS.map((row) => (
					<TableRow key={row.label}>
						<TableCell className="text-muted-foreground">{row.label}</TableCell>
						{pairs.map(({ key, comparison }) => {
							const before = comparison ? row.value(comparison.before) : null;
							const after = comparison ? row.value(comparison.after) : null;
							return [
								<TableCell
									key={`${key}-before`}
									className="border-l text-right text-muted-foreground"
								>
									{before === null ? "—" : row.show(before)}
								</TableCell>,
								<TableCell key={`${key}-after`} className="text-right">
									<span className="inline-flex items-center justify-end gap-1 font-medium">
										{after === null ? "—" : row.show(after)}
										{comparison && row.trend ? (
											<TrendArrow
												trend={comparison.trends[row.trend]}
												after={after}
												before={before}
											/>
										) : null}
									</span>
								</TableCell>,
							];
						})}
					</TableRow>
				))}
				<TableRow>
					<TableCell className="text-muted-foreground">Results</TableCell>
					{pairs.map(({ key, comparison }) => [
						<TableCell
							key={`${key}-before`}
							className="border-l text-right text-muted-foreground"
						>
							{comparison ? results(comparison.before) : "—"}
						</TableCell>,
						<TableCell key={`${key}-after`} className="text-right font-medium">
							{comparison ? results(comparison.after) : "—"}
						</TableCell>,
					])}
				</TableRow>
			</TableBody>
		</Table>
	);
}
