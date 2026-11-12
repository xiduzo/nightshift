import {
	formatWeekdayDate,
	type SpendDays,
	timesUsual,
} from "@nightshift/client";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@nightshift/ui/components/card";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import type { ReactNode } from "react";
import { formatCost } from "@/shared/format";

/**
 * The numbers on top of the Spend page: what the runs spent against the
 * days before, with a bar per day, how many flows have a steady cost,
 * which flow is hard to predict, and what the ways to save add up to.
 */
export function SpendTiles({ days }: { days: SpendDays }) {
	const rated = days.flows.filter((flow) => flow.steadiness !== null);
	const steady = rated.filter((flow) => flow.steadiness === "steady");
	const unsteady = rated
		.filter((flow) => flow.steadiness === "unsteady")
		.sort((a, b) => factor(b) - factor(a));
	const worst = unsteady[0];
	const share =
		days.total > 0 ? Math.round((days.saves / days.total) * 100) : 0;
	const changes = days.savings.length;
	return (
		<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[1.6fr_1fr_1fr_1fr]">
			<Card size="sm">
				<CardHeader>
					<CardDescription className="flex items-baseline gap-2">
						<span className="flex-1">Spent in the last {days.nights} days</span>
						<span className="text-xs tabular-nums">
							{days.runs} {days.runs === 1 ? "run" : "runs"}
						</span>
					</CardDescription>
					<CardTitle className="flex flex-wrap items-baseline gap-x-2.5 font-semibold text-2xl tabular-nums tracking-tight">
						{formatCost(days.total)}
						<span className="font-normal text-muted-foreground text-xs tracking-normal">
							{againstBefore(days)}
						</span>
					</CardTitle>
				</CardHeader>
				<CardContent className="flex flex-col gap-2">
					<DayBars days={days} />
					<div className="flex flex-wrap gap-x-3.5 gap-y-1 text-muted-foreground text-xs">
						<span className="flex items-center gap-1.5">
							<span
								className="size-2 rounded-xs bg-chart-1"
								aria-hidden="true"
							/>
							Spent
						</span>
						<span className="flex items-center gap-1.5">
							<span
								className="size-2 rounded-xs bg-status-waiting"
								aria-hidden="true"
							/>
							Part a change could save
						</span>
					</div>
				</CardContent>
			</Card>
			<Tile
				label="Steady flows"
				value={rated.length > 0 ? `${steady.length} of ${rated.length}` : "—"}
				hint={
					rated.length > 0
						? "Most of their runs cost within 20% of a usual run."
						: "No flow has enough finished runs yet."
				}
			/>
			<Tile
				label="Hard to predict"
				value={
					rated.length > 0
						? `${unsteady.length} ${unsteady.length === 1 ? "flow" : "flows"}`
						: "—"
				}
				hint={
					worst?.usual
						? `${worst.flow} cost up to ${timesUsual(worst.usual.max, worst.usual.median)} a usual run.`
						: rated.length > 0
							? "No flow has runs that cost far over a usual run."
							: null
				}
			/>
			<Tile
				label="You could save"
				value={changes > 0 ? formatCost(days.saves) : "—"}
				hint={
					changes > 0
						? `${share}% of ${formatCost(days.total)}, with ${changes} ${changes === 1 ? "change" : "changes"}.`
						: "Night Shift found no way to save in these days."
				}
			/>
		</div>
	);
}

/** How many times a usual run the dearest run of a flow cost. */
function factor(flow: SpendDays["flows"][number]): number {
	return flow.usual && flow.usual.median > 0
		? flow.usual.max / flow.usual.median
		: 0;
}

/** "+$58 against the 30 days before". Nothing while the days before had no spend. */
function againstBefore(days: SpendDays): string | null {
	if (days.before <= 0) return null;
	const change = days.total - days.before;
	if (Math.abs(change) < 0.005) return `as in the ${days.nights} days before`;
	return `${change > 0 ? "+" : "−"}${formatCost(Math.abs(change))} against the ${days.nights} days before`;
}

function Tile({
	label,
	value,
	hint,
}: {
	label: string;
	value: ReactNode;
	hint: ReactNode;
}) {
	return (
		<Card size="sm">
			<CardHeader>
				<CardDescription>{label}</CardDescription>
				<CardTitle className="font-semibold text-2xl tabular-nums tracking-tight">
					{value}
				</CardTitle>
			</CardHeader>
			{hint ? (
				<CardContent className="text-muted-foreground text-xs">
					{hint}
				</CardContent>
			) : null}
		</Card>
	);
}

/** One bar per day, oldest first: what the day spent, and on top the part a change could save. */
function DayBars({ days }: { days: SpendDays }) {
	const max = Math.max(...days.perNight.map((day) => day.costUsd), 0);
	return (
		<div className="flex h-10 items-end gap-px">
			{days.perNight.map((day) => (
				<Tooltip key={day.night}>
					<TooltipTrigger
						render={
							<span className="flex h-full flex-1 flex-col justify-end" />
						}
					>
						<span
							className="flex min-h-px flex-col overflow-hidden rounded-t-[2px] bg-chart-1"
							style={{
								height: max > 0 ? `${(day.costUsd / max) * 100}%` : undefined,
							}}
						>
							<span
								className="shrink-0 bg-status-waiting"
								style={{
									height:
										day.costUsd > 0
											? `${(Math.min(day.saves, day.costUsd) / day.costUsd) * 100}%`
											: 0,
								}}
							/>
						</span>
					</TooltipTrigger>
					<TooltipContent className="flex flex-col items-start gap-0.5 tabular-nums">
						<span>{formatWeekdayDate(day.night)}</span>
						<span>Spent {formatCost(day.costUsd)}</span>
						{day.saves > 0 ? (
							<span>A change could save {formatCost(day.saves)}</span>
						) : null}
					</TooltipContent>
				</Tooltip>
			))}
		</div>
	);
}
