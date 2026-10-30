/**
 * PROTOTYPE, throw away. Variant A: an agenda. The page answers "what
 * starts when" for the coming week, day by day, with what runs now on
 * top. The schedules themselves sit in a side column: on, on a webhook,
 * paused. A schedule that starts many times a day shows once per day.
 */

import { Badge } from "@nightshift/ui/components/badge";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@nightshift/ui/components/card";
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
import { RunStatusBadge } from "@/features/runs";
import { dayWord, formatTime } from "@/shared/format";
import {
	FinishedShare,
	inputsLine,
	OnSwitch,
	RunStrip,
	RunsOn,
	ScheduleMenu,
	StartIcon,
	whenSentence,
} from "./schedule-parts";
import type { ScheduleRow } from "./schedules-data";
import type { VariantProps } from "./schedules-prototype";

/** More starts than this in a day read as one line: "every 30 minutes". */
const MANY = 4;

type Entry = {
	row: ScheduleRow;
	/** The first start of the day. */
	at: number;
	/** How many starts that day. */
	count: number;
};

function dayStart(ms: number): number {
	const date = new Date(ms);
	return new Date(
		date.getFullYear(),
		date.getMonth(),
		date.getDate(),
	).getTime();
}

/** The coming starts, by day: one entry per start, or one per day when many. */
function agenda(rows: ScheduleRow[]): [number, Entry[]][] {
	const days = new Map<number, Entry[]>();
	for (const row of rows) {
		const perDay = new Map<number, number[]>();
		for (const at of row.upcoming) {
			const day = dayStart(at);
			perDay.set(day, [...(perDay.get(day) ?? []), at]);
		}
		for (const [day, times] of perDay) {
			const entries = days.get(day) ?? [];
			if (times.length > MANY) {
				entries.push({ row, at: times[0] ?? day, count: times.length });
			} else {
				for (const at of times) entries.push({ row, at, count: 1 });
			}
			days.set(day, entries);
		}
	}
	return [...days.entries()]
		.sort(([a], [b]) => a - b)
		.map(([day, entries]) => [day, entries.sort((a, b) => a.at - b.at)]);
}

export function VariantAgenda({
	projectId,
	rows,
	now,
	schedulerOff,
}: VariantProps) {
	const running = rows.flatMap((row) =>
		row.runs.filter((run) => run.endedAt === null).map((run) => ({ row, run })),
	);
	const days = schedulerOff ? [] : agenda(rows);
	const on = rows.filter((r) => r.schedule.enabled && !r.schedule.webhook);
	const hooks = rows.filter((r) => r.schedule.enabled && r.schedule.webhook);
	const paused = rows.filter((r) => !r.schedule.enabled);

	return (
		<div className="grid items-start gap-6 lg:grid-cols-[1fr_22rem]">
			<div className="flex flex-col gap-6">
				{running.length > 0 ? (
					<section className="flex flex-col gap-2">
						<h2 className="font-medium text-sm">Running now</h2>
						<ItemGroup className="gap-2">
							{running.map(({ row, run }) => (
								<Item
									key={run.id}
									variant="outline"
									size="sm"
									render={<Link to="/runs/$runId" params={{ runId: run.id }} />}
								>
									<ItemContent>
										<ItemTitle className="font-mono">{row.name}</ItemTitle>
										<ItemDescription>
											Started {formatTime(run.createdAt)}
											{run.stopAt ? `, stops ${formatTime(run.stopAt)}` : ""}
										</ItemDescription>
									</ItemContent>
									<ItemActions>
										<RunStatusBadge status={run.status} />
									</ItemActions>
								</Item>
							))}
						</ItemGroup>
					</section>
				) : null}

				<section className="flex flex-col gap-4">
					<h2 className="font-medium text-sm">Coming up this week</h2>
					{days.length === 0 ? (
						<p className="text-muted-foreground text-sm">
							{schedulerOff
								? "Nothing starts while schedules are paused."
								: "Nothing starts at a set time this week."}
						</p>
					) : (
						days.map(([day, entries]) => (
							<div key={day} className="grid gap-3 sm:grid-cols-[7rem_1fr]">
								<div className="flex flex-col pt-2">
									<span className="font-medium text-sm capitalize">
										{dayWord(day + 12 * 3600_000, now)}
									</span>
									<span className="text-muted-foreground text-xs">
										{new Date(day).toLocaleDateString(undefined, {
											day: "numeric",
											month: "short",
										})}
									</span>
								</div>
								<ItemGroup className="gap-1.5">
									{entries.map((entry) => (
										<AgendaEntry
											key={`${entry.row.schedule.id}-${entry.at}`}
											projectId={projectId}
											entry={entry}
											now={now}
										/>
									))}
								</ItemGroup>
							</div>
						))
					)}
				</section>
			</div>

			<aside className="flex flex-col gap-4">
				<SideList title="At set times" rows={on} />
				<SideList title="On a webhook" rows={hooks} />
				<SideList title="Paused" rows={paused} />
			</aside>
		</div>
	);
}

function AgendaEntry({
	projectId,
	entry,
	now,
}: {
	projectId: string;
	entry: Entry;
	now: number;
}) {
	const { row, at, count } = entry;
	const past = at <= now;
	const stop = row.stopsAfter(at);
	return (
		<Item variant="outline" size="sm" className={past ? "opacity-60" : ""}>
			<ItemMedia className="w-20 whitespace-nowrap font-medium font-mono text-sm tabular-nums">
				{formatTime(at)}
			</ItemMedia>
			<ItemContent>
				<ItemTitle className="font-mono">
					{row.schedule.flow ? (
						<Link
							to="/projects/$projectId/flows/$name"
							params={{ projectId, name: row.schedule.flow }}
							className="hover:underline"
						>
							{row.name}
						</Link>
					) : (
						row.name
					)}
				</ItemTitle>
				<ItemDescription>
					{count > 1
						? `${whenSentence(row.schedule)}, ${count} starts`
						: stop
							? `Runs until ${formatTime(stop)}`
							: whenSentence(row.schedule)}
				</ItemDescription>
			</ItemContent>
			<ItemActions>
				<RunsOn row={row} />
			</ItemActions>
		</Item>
	);
}

function SideList({ title, rows }: { title: string; rows: ScheduleRow[] }) {
	if (rows.length === 0) return null;
	return (
		<Card size="sm">
			<CardHeader>
				<CardTitle className="flex items-center gap-2 text-sm">
					{title}
					<Badge variant="secondary">{rows.length}</Badge>
				</CardTitle>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				{rows.map((row) => (
					<div key={row.schedule.id} className="flex flex-col gap-1.5">
						<div className="flex items-center gap-2">
							<StartIcon
								schedule={row.schedule}
								className="shrink-0 text-muted-foreground"
							/>
							<span className="min-w-0 flex-1 truncate font-medium font-mono text-sm">
								{row.name}
							</span>
							<OnSwitch row={row} />
							<ScheduleMenu row={row} />
						</div>
						<span className="text-muted-foreground text-xs">
							{whenSentence(row.schedule)}
						</span>
						{inputsLine(row.schedule) ? (
							<span className="truncate font-mono text-muted-foreground text-xs">
								{inputsLine(row.schedule)}
							</span>
						) : null}
						<div className="flex items-center justify-between gap-2">
							<RunStrip row={row} count={8} />
							<FinishedShare row={row} count={8} inline />
						</div>
					</div>
				))}
			</CardContent>
		</Card>
	);
}
