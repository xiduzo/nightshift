import { Card, CardContent } from "@nightshift/ui/components/card";
import {
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
} from "@nightshift/ui/components/chart";
import {
	ToggleGroup,
	ToggleGroupItem,
} from "@nightshift/ui/components/toggle-group";
import { type CSSProperties, useState } from "react";
import { Label, Pie, PieChart } from "recharts";
import type { DashboardSummary } from "@/shared/api";
import { PageSection } from "@/shared/page";
import { nightsOf } from "./ranges";
import { RUN_STATUS_CHART } from "./run-statuses";

const RANGES = [7, 30] as const;
type Range = (typeof RANGES)[number];

/** How runs ended, as a donut with the total inside, after the shadcn `chart-pie-donut-text` block. */
export function RunOutcomes({
	summary,
}: {
	summary: DashboardSummary | undefined;
}) {
	const [range, setRange] = useState<Range>(7);
	const runs = summary ? nightsOf(summary, range).runs : undefined;
	const total = runs?.runs ?? 0;
	const counts = (runs?.statuses ?? []).map(({ status, count }) => ({
		status,
		count,
		fill: `var(--color-${status})`,
	}));

	return (
		<PageSection
			title="Run outcomes"
			description={`Last ${range} nights.`}
			actions={
				<ToggleGroup
					variant="outline"
					size="sm"
					spacing={0}
					aria-label="Range"
					value={[String(range)]}
					onValueChange={(value) => {
						const next = Number(value[0]) as Range;
						if (RANGES.includes(next)) setRange(next);
					}}
				>
					{RANGES.map((nights) => (
						<ToggleGroupItem
							key={nights}
							value={String(nights)}
							aria-label={`Last ${nights} nights`}
							className="aria-pressed:bg-primary aria-pressed:text-primary-foreground"
						>
							{nights}n
						</ToggleGroupItem>
					))}
				</ToggleGroup>
			}
		>
			<Card size="sm">
				<CardContent>
					{total === 0 ? (
						<p className="rounded-md border border-dashed px-4 py-6 text-center text-muted-foreground text-sm">
							No runs in the last {range} nights.
						</p>
					) : (
						<div className="flex items-center gap-4">
							<ChartContainer
								config={RUN_STATUS_CHART}
								initialDimension={{ width: 128, height: 128 }}
								className="aspect-square size-32 shrink-0"
							>
								<PieChart margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
									<ChartTooltip
										cursor={false}
										content={<ChartTooltipContent nameKey="status" hideLabel />}
									/>
									<Pie
										data={counts}
										dataKey="count"
										nameKey="status"
										innerRadius="62%"
										outerRadius="100%"
										// A gap between slices; one slice alone would show a seam.
										strokeWidth={counts.length > 1 ? 2 : 0}
										stroke="var(--card)"
										isAnimationActive={false}
									>
										<Label
											content={({ viewBox }) =>
												viewBox && "cx" in viewBox && "cy" in viewBox ? (
													<text
														x={viewBox.cx}
														y={viewBox.cy}
														textAnchor="middle"
														dominantBaseline="middle"
													>
														<tspan
															x={viewBox.cx}
															y={viewBox.cy}
															className="fill-foreground font-semibold text-2xl tabular-nums"
														>
															{total}
														</tspan>
														<tspan
															x={viewBox.cx}
															y={(viewBox.cy ?? 0) + 18}
															className="fill-muted-foreground text-xs"
														>
															{total === 1 ? "run" : "runs"}
														</tspan>
													</text>
												) : null
											}
										/>
									</Pie>
								</PieChart>
							</ChartContainer>
							<ul className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm">
								{counts.map(({ status, count }) => (
									<li key={status} className="flex items-center gap-2">
										<span
											className="size-2.5 shrink-0 rounded-[2px] bg-(--swatch)"
											style={
												{
													"--swatch": RUN_STATUS_CHART[status].color,
												} as CSSProperties
											}
										/>
										<span className="truncate text-muted-foreground">
											{RUN_STATUS_CHART[status].label}
										</span>
										<span className="ml-auto font-medium tabular-nums">
											{count}
										</span>
										<span className="w-9 text-right text-muted-foreground text-xs tabular-nums">
											{Math.round((count / total) * 100)}%
										</span>
									</li>
								))}
							</ul>
						</div>
					)}
				</CardContent>
			</Card>
		</PageSection>
	);
}
