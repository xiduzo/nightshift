import { Card, CardContent, CardFooter } from "@nightshift/ui/components/card";
import {
	type ChartConfig,
	ChartContainer,
	ChartLegend,
	ChartLegendContent,
	ChartTooltip,
	ChartTooltipContent,
} from "@nightshift/ui/components/chart";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import type { DashboardSummary } from "@/shared/api";
import { formatCost } from "@/shared/format";
import { PageSection } from "@/shared/page";
import { Swatch } from "./details";
import { nightChartRows } from "./nights";
import { nightsOf } from "./ranges";

/** The nights the line covers. */
const NIGHTS = 7;

/**
 * What each flow of the project cost per night over the last week, one
 * line per flow, after the shadcn `chart-line-multiple` block. The flows
 * that spent the most get a line each; the rest share one.
 */
export function FlowCost({
	summary,
}: {
	summary: DashboardSummary | undefined;
}) {
	const spend = summary ? nightsOf(summary, NIGHTS).spend : undefined;
	const config = Object.fromEntries(
		(spend?.groups ?? []).map((group, index) => [
			group.key,
			{
				label: group.label,
				color:
					group.key === "other"
						? "var(--muted-foreground)"
						: `var(--chart-${index + 1})`,
			},
		]),
	) satisfies ChartConfig;

	return (
		<PageSection title="Cost per flow" description={`Last ${NIGHTS} nights.`}>
			<Card size="sm">
				<CardContent>
					{!spend || spend.total === 0 ? (
						<p className="rounded-md border border-dashed px-4 py-6 text-center text-muted-foreground text-sm">
							No spend in the last {NIGHTS} nights.
						</p>
					) : (
						<ChartContainer config={config} className="aspect-auto h-48 w-full">
							<LineChart
								data={nightChartRows(spend.perNight)}
								margin={{ left: 0, right: 8, top: 4 }}
								accessibilityLayer
							>
								<CartesianGrid vertical={false} />
								<XAxis
									dataKey="label"
									tickLine={false}
									axisLine={false}
									tickMargin={8}
									minTickGap={16}
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
											formatter={(value, name) => (
												<div className="flex w-full items-center gap-2">
													<Swatch color={`var(--color-${name})`} />
													<span className="text-muted-foreground">
														{config[name as string]?.label ?? name}
													</span>
													<span className="ml-auto font-medium font-mono tabular-nums">
														{formatCost(Number(value))}
													</span>
												</div>
											)}
										/>
									}
								/>
								<ChartLegend content={<ChartLegendContent />} />
								{spend.groups.map((group) => (
									<Line
										key={group.key}
										dataKey={group.key}
										type="monotone"
										stroke={`var(--color-${group.key})`}
										strokeWidth={2}
										dot={false}
										isAnimationActive={false}
									/>
								))}
							</LineChart>
						</ChartContainer>
					)}
				</CardContent>
				{spend && spend.unknown > 0 ? (
					<CardFooter className="text-muted-foreground text-xs">
						{spend.unknown === 1
							? "1 run has a step that did not report its cost. The lines leave that step out."
							: `${spend.unknown} runs have a step that did not report its cost. The lines leave those steps out.`}
					</CardFooter>
				) : null}
			</Card>
		</PageSection>
	);
}
