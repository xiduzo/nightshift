/** The charts of a flow's health: runs per night and cost per run. */
import {
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
} from "@nightshift/ui/components/chart";
import {
	Bar,
	BarChart,
	CartesianGrid,
	Cell,
	ReferenceLine,
	XAxis,
	YAxis,
} from "recharts";
import type { FlowRange, RunStatus } from "@/shared/api";
import { formatCost, formatDateTime } from "@/shared/format";
import { ChartSection, DetailsEmpty, Swatch } from "./details";
import { formatNightShort, nightChartRows } from "./nights";
import { RUN_STATUS_CHART } from "./run-statuses";

/** Runs per night, stacked by status, like the Runs details. */
export function RunsPerNight({
	perNight,
	statuses: counts,
}: {
	perNight: FlowRange["perNight"];
	/** The statuses that occur, in the chart's order. */
	statuses: FlowRange["statuses"];
}) {
	const statuses = counts.map(({ status }) => status);
	const rows = nightChartRows(perNight);
	const config = Object.fromEntries(
		statuses.map((status) => [status, RUN_STATUS_CHART[status]]),
	);
	return (
		<ChartSection
			title="History"
			hint="Runs per night, noon to noon, by status"
		>
			<ChartContainer config={config} className="aspect-auto h-48 w-full">
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
		</ChartSection>
	);
}

/**
 * One bar per ended run, oldest first, in the color of how it ended. The
 * dashed line is the median of the finished runs, so a dear run stands out.
 */
export function CostPerRun({
	runs,
	median,
}: {
	runs: FlowRange["endedRuns"];
	median: number | undefined;
}) {
	const rows = runs.map((run, index) => ({
		key: `${run.runId}-${index}`,
		label: formatNightShort(run.night),
		title: formatDateTime(run.startedAt),
		costUsd: run.costUsd,
		status: run.status,
	}));
	const config = Object.fromEntries(
		[...new Set(runs.map((run) => run.status))].map((status) => [
			status,
			RUN_STATUS_CHART[status],
		]),
	);
	return (
		<ChartSection
			title="Cost per run"
			hint={
				median === undefined
					? "Each ended run, oldest first"
					: `Each ended run, oldest first. The dashed line is the median of the finished runs that used an agent, ${formatCost(median)}.`
			}
		>
			{runs.length === 0 ? (
				<DetailsEmpty>No run has ended yet.</DetailsEmpty>
			) : (
				<ChartContainer config={config} className="aspect-auto h-48 w-full">
					<BarChart data={rows} margin={{ left: 0, right: 0 }}>
						<CartesianGrid vertical={false} />
						<XAxis
							dataKey="key"
							tickFormatter={(_, index) => rows[index]?.label ?? ""}
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
									labelFormatter={(_, payload) =>
										String(payload[0]?.payload?.title ?? "")
									}
									formatter={(value, _, item) => {
										const status = item.payload?.status as RunStatus;
										return (
											<div className="flex w-full items-center gap-2">
												<Swatch color={`var(--color-${status})`} />
												<span className="text-muted-foreground">
													{RUN_STATUS_CHART[status]?.label ?? status}
												</span>
												<span className="ml-auto font-medium font-mono tabular-nums">
													{formatCost(Number(value))}
												</span>
											</div>
										);
									}}
								/>
							}
						/>
						{median !== undefined ? (
							<ReferenceLine
								y={median}
								strokeDasharray="4 4"
								className="stroke-muted-foreground"
							/>
						) : null}
						<Bar dataKey="costUsd" radius={[4, 4, 0, 0]}>
							{rows.map((row) => (
								<Cell key={row.key} fill={`var(--color-${row.status})`} />
							))}
						</Bar>
					</BarChart>
				</ChartContainer>
			)}
		</ChartSection>
	);
}
