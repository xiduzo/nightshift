import { Button } from "@nightshift/ui/components/button";
import {
	type ChartConfig,
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
} from "@nightshift/ui/components/chart";
import { DialogFooter } from "@nightshift/ui/components/dialog";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { Link } from "@tanstack/react-router";
import { ArrowRightIcon, LoaderCircleIcon } from "lucide-react";
import { useId, useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { RunStatusBadge } from "@/components/run-status-badge";
import { useNow } from "@/hooks/use-now";
import type { Project, RunSummary } from "@/lib/api-types";
import {
	formatDayTime,
	formatDuration,
	formatRelative,
	formatTime,
} from "@/lib/format";

import { activePerHour, isOpen } from "./activity";
import {
	ChartSection,
	DetailsDialog,
	DetailsEmpty,
	DetailsHeader,
	RangeToggle,
	Stat,
	Swatch,
} from "./details";
import { spendGroupOf } from "./spend";

/** In hours: a day, two, a week. */
const RANGES = [24, 48, 168] as const;
type Range = (typeof RANGES)[number];
const CHART_CONFIG = {
	active: { label: "Runs at work", color: "var(--status-running)" },
} satisfies ChartConfig;

/**
 * What is at work, in detail: the open runs, how many ran at once per hour,
 * and the peak. Behind the "Running now" card.
 */
export function ActivityDialog({
	open,
	onOpenChange,
	runs,
	project,
	projects,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	runs: RunSummary[];
	/** One project; otherwise all of them. */
	project?: Project;
	/** To name the project of each run, over all projects. */
	projects?: Project[];
}) {
	return (
		<DetailsDialog open={open} onOpenChange={onOpenChange}>
			<ActivityDetails
				runs={runs}
				project={project}
				projects={projects}
				onNavigate={() => onOpenChange(false)}
			/>
		</DetailsDialog>
	);
}

function ActivityDetails({
	runs,
	project,
	projects,
	onNavigate,
}: {
	runs: RunSummary[];
	project?: Project;
	projects?: Project[];
	onNavigate: () => void;
}) {
	const id = useId();
	const now = useNow(60_000);
	const [range, setRange] = useState<Range>(24);
	const groupOf = spendGroupOf(project, projects);
	const hours = activePerHour(runs, range, now);
	const since = hours[0]?.hour ?? now;
	const peak = Math.max(0, ...hours.map((hour) => hour.active));
	const busy = hours.filter((hour) => hour.active > 0).length;
	const started = runs.filter((run) => run.createdAt >= since).length;
	const open = runs.filter(isOpen).sort((a, b) => a.createdAt - b.createdAt);
	const running = open.filter((run) => run.status === "running").length;
	const nextWake = open
		.flatMap((run) => (run.wakeAt ? [run.wakeAt] : []))
		.sort((a, b) => a - b)[0];
	const rows = hours.map(({ hour, active }) => ({
		active,
		label:
			range > 48
				? new Date(hour).toLocaleDateString(undefined, { weekday: "short" })
				: formatTime(hour),
		title: formatDayTime(hour),
	}));
	const rangeWord = range > 48 ? "7 days" : `${range} h`;

	return (
		<>
			<DetailsHeader project={project} trail="Runs" title="Activity" />

			<Item variant="muted" size="sm">
				<ItemMedia variant="icon">
					<LoaderCircleIcon />
				</ItemMedia>
				<ItemContent>
					<ItemTitle>Running now</ItemTitle>
					<ItemDescription>
						{nextWake
							? `${open.length} open, the next wakes at ${formatTime(nextWake)}`
							: open.length > 0
								? `${open.length} open`
								: "Nothing open"}
					</ItemDescription>
				</ItemContent>
				<ItemActions className="font-semibold text-lg tabular-nums">
					{running}
				</ItemActions>
			</Item>

			<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
				<Stat
					label="Open"
					value={String(open.length)}
					hint="Running, waiting, asleep"
				/>
				<Stat
					label="Peak"
					value={String(peak)}
					hint={`At once, last ${rangeWord}`}
				/>
				<Stat
					label="Busy hours"
					value={String(busy)}
					hint={`Of the last ${rangeWord}`}
				/>
				<Stat
					label="Started"
					value={String(started)}
					hint={`Last ${rangeWord}`}
				/>
			</div>

			<ChartSection
				title="At work"
				hint="Runs at work in each hour, from start to end"
				toggle={
					<RangeToggle
						ranges={RANGES}
						value={range}
						onValueChange={setRange}
						short={(hours) => (hours > 48 ? "7d" : `${hours}h`)}
						long={(hours) =>
							hours > 48 ? "Last 7 days" : `Last ${hours} hours`
						}
					/>
				}
			>
				{peak === 0 ? (
					<DetailsEmpty>Nothing ran in the last {rangeWord}.</DetailsEmpty>
				) : (
					<ChartContainer
						config={CHART_CONFIG}
						className="aspect-auto h-56 w-full"
					>
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
										formatter={(value) => (
											<div className="flex w-full items-center gap-2">
												<Swatch color="var(--color-active)" />
												<span className="text-muted-foreground">
													Runs at work
												</span>
												<span className="ml-auto font-medium font-mono tabular-nums">
													{Number(value)}
												</span>
											</div>
										)}
									/>
								}
							/>
							<Bar
								dataKey="active"
								fill="var(--color-active)"
								radius={[4, 4, 0, 0]}
							/>
						</BarChart>
					</ChartContainer>
				)}
			</ChartSection>

			<section aria-labelledby={`${id}-open`} className="flex flex-col gap-2">
				<h3 id={`${id}-open`} className="font-medium text-base">
					Open runs
				</h3>
				{open.length === 0 ? (
					<DetailsEmpty>No run is at work, waiting or asleep.</DetailsEmpty>
				) : (
					<ItemGroup className="gap-1">
						{open.map((run) => (
							<Item
								key={run.id}
								size="xs"
								render={
									<Link
										to="/runs/$runId"
										params={{ runId: run.id }}
										onClick={onNavigate}
									/>
								}
							>
								<ItemContent className="min-w-0">
									<ItemTitle className="w-full truncate">{run.title}</ItemTitle>
									<ItemDescription>
										{project ? null : `${groupOf(run)}, `}
										started {formatRelative(run.createdAt, now)}
										{run.wakeAt ? `, wakes at ${formatTime(run.wakeAt)}` : null}
									</ItemDescription>
								</ItemContent>
								<ItemActions>
									<RunStatusBadge status={run.status} />
									<span className="w-20 text-right text-muted-foreground tabular-nums">
										{formatDuration(Math.max(now - run.createdAt, 0))}
									</span>
								</ItemActions>
							</Item>
						))}
					</ItemGroup>
				)}
			</section>

			{project ? (
				<DialogFooter>
					<Button
						variant="outline"
						nativeButton={false}
						render={
							<Link
								to="/projects/$projectId/runs"
								params={{ projectId: project.id }}
								onClick={onNavigate}
							/>
						}
					>
						All runs
						<ArrowRightIcon data-icon="inline-end" />
					</Button>
				</DialogFooter>
			) : null}
		</>
	);
}
