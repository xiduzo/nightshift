/**
 * PROTOTYPE, throw away. Variant A's "Tonight": the scheduled starts, the
 * wake-ups and the stop times, soonest first, as a short vertical timeline.
 * The same items as `../up-next.tsx`.
 */

import { Button } from "@nightshift/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { Link, type LinkProps } from "@tanstack/react-router";
import {
	CalendarClockIcon,
	type LucideIcon,
	MoonIcon,
	OctagonPauseIcon,
} from "lucide-react";
import { scheduleQueries } from "@/features/schedules";
import type { DashboardSummary } from "@/shared/api";
import { dayWord, formatTime, useNow } from "@/shared/format";

const MAX_ITEMS = 5;

type Upcoming = {
	key: string;
	at: number;
	icon: LucideIcon;
	title: string;
	description: string;
	link: Pick<LinkProps, "to" | "params">;
};

export function BriefTonight({
	projectId,
	upNext,
}: {
	projectId: string;
	upNext: DashboardSummary["upNext"] | undefined;
}) {
	const now = useNow(60_000);
	const schedules = useQuery(scheduleQueries.listLive(projectId));

	const upcoming: Upcoming[] = [
		...(schedules.data?.schedules ?? []).flatMap((schedule) =>
			schedule.enabled && schedule.nextAt
				? [
						{
							key: `schedule:${schedule.id}`,
							at: schedule.nextAt,
							icon: CalendarClockIcon,
							title: schedule.flow ?? schedule.id,
							description: schedule.stopAt
								? `Starts on schedule, stops at ${schedule.stopAt}`
								: "Starts on schedule",
							link: {
								to: "/projects/$projectId/schedules",
								params: { projectId },
							},
						} satisfies Upcoming,
					]
				: [],
		),
		...(upNext ?? []).map(
			(item) =>
				({
					key: `${item.kind}:${item.runId}`,
					at: item.at,
					icon: item.kind === "wake" ? MoonIcon : OctagonPauseIcon,
					title: item.title,
					description:
						item.kind === "wake"
							? "Wakes and goes on"
							: "No new step starts after this time",
					link: { to: "/runs/$runId", params: { runId: item.runId } },
				}) satisfies Upcoming,
		),
	]
		.filter((item) => item.at >= now)
		.sort((a, b) => a.at - b.at)
		.slice(0, MAX_ITEMS);

	if (upcoming.length === 0) {
		return (
			<p className="text-muted-foreground text-sm">
				Nothing is planned.{" "}
				<Button
					variant="link"
					className="h-auto p-0"
					nativeButton={false}
					render={
						<Link to="/projects/$projectId/schedules" params={{ projectId }} />
					}
				>
					Add a schedule
				</Button>{" "}
				to start a flow at night.
			</p>
		);
	}

	return (
		<ol className="flex flex-col">
			{upcoming.map(
				({ key, at, icon: Icon, title, description, link }, index) => (
					<li key={key} className="relative flex gap-4 pb-5 last:pb-0">
						{index < upcoming.length - 1 ? (
							<span
								aria-hidden="true"
								className="absolute top-7 bottom-0 left-[4.875rem] w-px bg-border"
							/>
						) : null}
						<div className="w-12 shrink-0 pt-1 text-right">
							<p className="font-medium text-sm tabular-nums">
								{formatTime(at)}
							</p>
							<p className="text-muted-foreground text-xs">
								{dayWord(at, now)}
							</p>
						</div>
						<span className="z-10 flex size-7 shrink-0 items-center justify-center rounded-full border bg-background text-muted-foreground">
							<Icon className="size-3.5" />
						</span>
						<Link
							{...link}
							className="min-w-0 flex-1 rounded-md pt-0.5 hover:underline"
						>
							<p className="truncate font-medium font-mono text-sm">{title}</p>
							<p className="text-muted-foreground text-xs">{description}</p>
						</Link>
					</li>
				),
			)}
		</ol>
	);
}
