import { changeOf } from "@nightshift/client";
import { Button } from "@nightshift/ui/components/button";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { Toggle } from "@nightshift/ui/components/toggle";
import { ArrowUpRightIcon, CheckSquareIcon, SquareIcon } from "lucide-react";
import { METRICS, type Metric, type MetricValues } from "./metrics";
import { TrendIcon } from "./trend-icon";

/**
 * The four numbers on top, flush in one row. A tile switches its number
 * on the chart on or off and fills with a light shade of its colour while
 * on. Each says how it moved against the nights before, and opens its
 * details.
 */
export function MetricTiles({
	values,
	before,
	compared,
	on,
	onChange,
	onDetails,
}: {
	/** Undefined while they load. */
	values: MetricValues | undefined;
	before: MetricValues | undefined;
	/** False while the nights before had no runs to compare with. */
	compared: boolean;
	on: Metric[];
	onChange: (on: Metric[]) => void;
	onDetails: (metric: Metric) => void;
}) {
	return (
		<div className="grid grid-cols-2 overflow-hidden rounded-xl border lg:grid-cols-4">
			{METRICS.map((metric) => {
				const pressed = on.includes(metric.key);
				const value = values?.[metric.key] ?? null;
				return (
					<div
						key={metric.key}
						className="relative flex border-r last:border-r-0"
						// A tile that is on takes the colour of its line on the chart.
						style={
							pressed
								? {
										backgroundColor: `var(--metric-${metric.key}-tile)`,
										color: `var(--metric-${metric.key}-tile-foreground)`,
									}
								: undefined
						}
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
							aria-label={`Show ${metric.label.toLowerCase()} on the chart`}
							className="h-auto w-full flex-col items-start justify-start gap-3 rounded-none p-4 text-left text-inherit hover:bg-transparent hover:text-inherit aria-pressed:bg-transparent aria-pressed:text-inherit"
						>
							<span className="flex items-center gap-2 font-medium text-sm">
								{pressed ? <CheckSquareIcon /> : <SquareIcon />}
								{metric.label}
							</span>
							{values ? (
								<span className="font-semibold text-4xl tabular-nums tracking-tight">
									{metric.format(value)}
								</span>
							) : (
								<Skeleton className="h-10 w-20" />
							)}
							{values && before ? (
								<Change
									metric={metric.key}
									value={value}
									before={compared ? before[metric.key] : undefined}
								/>
							) : (
								<Skeleton className="h-4 w-40" />
							)}
						</Toggle>
						<Button
							variant="link"
							size="xs"
							className="absolute top-3 right-3 text-inherit"
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

/** How a number moved against the same nights just before, in a sentence. */
function Change({
	metric,
	value,
	before,
}: {
	metric: Metric;
	value: number | null;
	before: number | null | undefined;
}) {
	const change = changeOf(metric, value, before);
	return (
		<span className="flex items-center gap-1 text-xs">
			<TrendIcon trend={change.trend} />
			{change.text}
		</span>
	);
}
