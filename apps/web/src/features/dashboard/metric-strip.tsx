import { Button } from "@nightshift/ui/components/button";
import { Card } from "@nightshift/ui/components/card";
import {
	type ChartConfig,
	ChartContainer,
} from "@nightshift/ui/components/chart";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { Line, LineChart, YAxis } from "recharts";
import {
	changeOf,
	METRICS,
	type Metric,
	type MetricRow,
	type metricsOf,
} from "./metrics";
import { TrendIcon } from "./trend-icon";

/**
 * Home's four numbers in one slim row, each with a small line per night
 * and the nights before dashed. A number opens its details.
 */
export function MetricStrip({
	metrics,
	onDetails,
}: {
	/** Undefined while they load. */
	metrics: ReturnType<typeof metricsOf> | undefined;
	onDetails: (metric: Metric) => void;
}) {
	return (
		<Card className="gap-0 py-0">
			<div className="grid grid-cols-2 divide-x lg:grid-cols-4">
				{METRICS.map((metric) => {
					const change = metrics
						? changeOf(
								metric.key,
								metrics.values[metric.key],
								metrics.compared ? metrics.before[metric.key] : undefined,
							)
						: undefined;
					return (
						<Button
							key={metric.key}
							variant="ghost"
							onClick={() => onDetails(metric.key)}
							className="grid h-auto grid-cols-[1fr_96px] items-center gap-3 rounded-none px-4 py-3 text-left font-normal"
						>
							<span className="flex flex-col">
								<span className="text-muted-foreground text-xs">
									{metric.label}
								</span>
								{metrics ? (
									<span className="font-semibold text-xl tabular-nums">
										{metric.format(metrics.values[metric.key])}
									</span>
								) : (
									<Skeleton className="my-1 h-5 w-14" />
								)}
								{change ? (
									<span className="flex items-center gap-1 text-muted-foreground text-xs [&_svg]:size-3">
										<TrendIcon trend={change.trend} />
										<span aria-hidden="true">{change.short}</span>
										<span className="sr-only">{change.text}</span>
									</span>
								) : null}
							</span>
							{metrics ? (
								<Sparkline
									rows={metrics.rows}
									metric={metric.key}
									color={metric.color}
									compared={metrics.compared}
								/>
							) : null}
						</Button>
					);
				})}
			</div>
		</Card>
	);
}

/** One metric per night, small, with the nights before dashed. */
function Sparkline({
	rows,
	metric,
	color,
	compared,
}: {
	rows: MetricRow[];
	metric: Metric;
	color: string;
	compared: boolean;
}) {
	const config = { [metric]: { label: metric, color } } satisfies ChartConfig;
	return (
		<ChartContainer
			config={config}
			className="aspect-auto h-10 w-full"
			aria-hidden="true"
		>
			<LineChart data={rows} margin={{ top: 2, bottom: 2, left: 0, right: 0 }}>
				<YAxis hide domain={metric === "finished" ? [0, 100] : [0, "auto"]} />
				{compared ? (
					<Line
						dataKey={`before_${metric}`}
						type="monotone"
						stroke={color}
						strokeWidth={1}
						strokeDasharray="3 3"
						strokeOpacity={0.5}
						dot={false}
						connectNulls
						isAnimationActive={false}
					/>
				) : null}
				<Line
					dataKey={metric}
					type="monotone"
					stroke={color}
					strokeWidth={1.5}
					dot={false}
					connectNulls
					isAnimationActive={false}
				/>
			</LineChart>
		</ChartContainer>
	);
}
