/**
 * PROTOTYPE, throw away. Home variant D, "By project": the console of a
 * project's page, but the chart splits the number into projects. The tiles
 * pick one metric, the chart draws a line per project, and a ranking under
 * it says which project drives the number and how each moved.
 */

import { Card, CardContent } from "@nightshift/ui/components/card";
import {
	type ChartConfig,
	ChartContainer,
	ChartLegend,
	ChartLegendContent,
	ChartTooltip,
	ChartTooltipContent,
} from "@nightshift/ui/components/chart";
import { Progress } from "@nightshift/ui/components/progress";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@nightshift/ui/components/table";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import type { NightRange } from "@/shared/api";
import { useNow } from "@/shared/format";
import { PageHeading } from "@/shared/page";
import { MetricTiles } from "../metric-tiles";
import { METRICS, type Metric } from "../metrics";
import { RangeBar } from "../range-bar";
import { changeOf, type useHomeData } from "./home-data";
import { HomeDetails, HomeNow, LastRunsStrip, lastRunsOf } from "./home-parts";

type Data = ReturnType<typeof useHomeData>;

const PROJECT_COLORS = [
	"var(--chart-1)",
	"var(--chart-2)",
	"var(--chart-3)",
	"var(--chart-4)",
	"var(--chart-5)",
];

export function VariantByProject({
	data,
	range,
	onRangeChange,
}: {
	data: Data;
	range: NightRange;
	onRangeChange: (range: NightRange) => void;
}) {
	const now = useNow();
	const [metric, setMetric] = useState<Metric>("runs");
	const [details, setDetails] = useState<{ metric: Metric; open: boolean }>();
	const { metrics } = data;
	const picked = METRICS.find((each) => each.key === metric) ?? METRICS[0];

	const projects = data.perProject
		.map((row, index) => ({
			...row,
			key: `p${index}`,
			color: PROJECT_COLORS[index % PROJECT_COLORS.length] ?? "var(--chart-1)",
			value: row.metrics?.values[metric] ?? null,
		}))
		.sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
	const config = Object.fromEntries(
		projects.map((row) => [
			row.key,
			{ label: row.project.name, color: row.color },
		]),
	) satisfies ChartConfig;
	const rows = (metrics?.rows ?? []).map((night, index) => ({
		label: night.label,
		title: night.title,
		...Object.fromEntries(
			projects.map((row) => [
				row.key,
				row.metrics?.rows[index]?.[metric] ?? null,
			]),
		),
	}));
	const total = metrics?.values[metric] ?? 0;
	// A share of the total only adds up for counts and money, not a percentage.
	const shares = metric !== "finished" && total > 0;

	return (
		<>
			<PageHeading
				title="Tonight"
				description="Pick a number to see which project drives it."
			/>
			<RangeBar value={range} onValueChange={onRangeChange} />
			<HomeNow summary={data.summary} gates={data.gates} />
			<MetricTiles
				values={metrics?.values}
				before={metrics?.before}
				compared={metrics?.compared ?? false}
				on={[metric]}
				// One at a time: the tile you switch on replaces the one that was.
				onChange={(next) =>
					setMetric(next.find((key) => key !== metric) ?? metric)
				}
				onDetails={(key) => setDetails({ metric: key, open: true })}
			/>
			<Card>
				<CardContent>
					{metrics ? (
						<ChartContainer config={config} className="aspect-auto h-72 w-full">
							<LineChart data={rows} margin={{ left: 4, right: 4, top: 8 }}>
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
									domain={metric === "finished" ? [0, 100] : [0, "auto"]}
									tickFormatter={(value: number) => picked.format(value)}
								/>
								<ChartTooltip
									content={
										<ChartTooltipContent
											labelFormatter={(_, payload) =>
												(payload?.[0]?.payload as { title?: string })?.title
											}
										/>
									}
								/>
								<ChartLegend content={<ChartLegendContent />} />
								{projects.map((row) => (
									<Line
										key={row.key}
										dataKey={row.key}
										type="monotone"
										stroke={`var(--color-${row.key})`}
										strokeWidth={2}
										dot={false}
										connectNulls
									/>
								))}
							</LineChart>
						</ChartContainer>
					) : (
						<Skeleton className="h-72 w-full" />
					)}
				</CardContent>
			</Card>

			<Card className="py-0">
				<CardContent className="px-0">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className="pl-6">Project</TableHead>
								<TableHead>Last runs</TableHead>
								<TableHead className="text-right">{picked.label}</TableHead>
								{shares ? <TableHead className="w-48">Share</TableHead> : null}
								<TableHead className="pr-6 text-right">
									Against the nights before
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{projects.map((row) => {
								const change = row.metrics
									? changeOf(
											metric,
											row.value,
											row.metrics.before[metric],
											row.metrics.compared,
										)
									: undefined;
								const share =
									shares && row.value !== null
										? Math.round((row.value / total) * 100)
										: null;
								return (
									<TableRow key={row.project.id}>
										<TableCell className="pl-6">
											<span className="flex items-center gap-2">
												<span
													className="size-2.5 rounded-[2px]"
													style={{ backgroundColor: row.color }}
												/>
												<Link
													to="/projects/$projectId"
													params={{ projectId: row.project.id }}
													search={{ range }}
													className="font-medium hover:underline"
												>
													{row.project.name}
												</Link>
											</span>
										</TableCell>
										<TableCell>
											<LastRunsStrip
												runs={lastRunsOf(row.nights, 8)}
												now={now}
												oneLine
											/>
										</TableCell>
										<TableCell className="text-right font-medium tabular-nums">
											{row.metrics ? picked.format(row.value) : "…"}
										</TableCell>
										{shares ? (
											<TableCell>
												{share === null ? null : (
													<span className="flex items-center gap-2">
														<Progress value={share} className="w-24" />
														<span className="text-muted-foreground text-xs tabular-nums">
															{share}%
														</span>
													</span>
												)}
											</TableCell>
										) : null}
										<TableCell className="pr-6 text-right">
											{change ? (
												<span className="inline-flex items-center gap-1 text-muted-foreground text-xs [&_svg]:size-3">
													{change.icon}
													{change.text}
												</span>
											) : null}
										</TableCell>
									</TableRow>
								);
							})}
						</TableBody>
					</Table>
				</CardContent>
			</Card>

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
