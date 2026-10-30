import {
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
} from "@nightshift/ui/components/chart";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { METRICS, METRICS_CHART, type Metric, type MetricRow } from "./metrics";

/**
 * The metrics that are on, one line each per night, and the same nights
 * just before as a dashed line. The first two get an axis, left and right.
 * While the nights before had no runs, it draws no dashed lines and says so.
 */
export function MetricsChart({
	rows,
	on,
	compared,
}: {
	rows: MetricRow[];
	on: Metric[];
	compared: boolean;
}) {
	if (on.length === 0) {
		return (
			<p className="flex h-72 items-center justify-center text-muted-foreground text-sm">
				Choose a number above to see it per night.
			</p>
		);
	}
	const shown = METRICS.filter((metric) => on.includes(metric.key));

	return (
		<div className="flex flex-col gap-2">
			<ChartContainer
				config={METRICS_CHART}
				className="aspect-auto h-72 w-full"
			>
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
									(payload?.[0]?.payload as MetricRow | undefined)?.title
								}
								formatter={(value, name, item) => {
									const metric = METRICS.find((each) => each.key === name);
									if (!metric) return null;
									const row = item.payload as MetricRow;
									return (
										<TooltipLine
											label={metric.label}
											color={metric.color}
											value={metric.format(value as number | null)}
											before={
												compared
													? metric.format(row[`before_${metric.key}`] ?? null)
													: undefined
											}
										/>
									);
								}}
							/>
						}
					/>
					{shown.flatMap((metric) => [
						<Line
							key={metric.key}
							yAxisId={metric.key}
							dataKey={metric.key}
							type="monotone"
							stroke={`var(--color-${metric.key})`}
							strokeWidth={2}
							dot={false}
							connectNulls
						/>,
						<Line
							key={`before_${metric.key}`}
							yAxisId={metric.key}
							dataKey={`before_${metric.key}`}
							type="monotone"
							stroke={`var(--color-${metric.key})`}
							strokeWidth={1.5}
							strokeDasharray="4 4"
							strokeOpacity={0.6}
							dot={false}
							connectNulls
							hide={!compared}
							// Its value shows beside the line's own, not as a row.
							tooltipType="none"
						/>,
					])}
				</LineChart>
			</ChartContainer>
			{compared ? null : (
				<p className="text-center text-muted-foreground text-xs">
					The nights before had no runs, so there is nothing to compare with
					yet.
				</p>
			)}
		</div>
	);
}

/** One metric in the tooltip: its night, and the night as far back. */
function TooltipLine({
	label,
	color,
	value,
	before,
}: {
	label: string;
	color: string;
	value: string;
	before: string | undefined;
}) {
	return (
		<>
			<div
				className="size-2.5 shrink-0 rounded-[2px]"
				style={{ backgroundColor: color }}
			/>
			<div className="flex flex-1 items-center justify-between gap-4 leading-none">
				<span className="text-muted-foreground">{label}</span>
				<span className="font-medium font-mono text-foreground tabular-nums">
					{value}
					{before === undefined ? null : (
						<span className="font-normal text-muted-foreground">
							{" "}
							({before} before)
						</span>
					)}
				</span>
			</div>
		</>
	);
}
