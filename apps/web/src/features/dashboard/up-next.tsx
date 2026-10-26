import { waitedText } from "@nightshift/client";
import { Button } from "@nightshift/ui/components/button";
import { Card, CardContent } from "@nightshift/ui/components/card";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { useQuery } from "@tanstack/react-query";
import { Link, type LinkProps } from "@tanstack/react-router";
import {
	ArrowRightIcon,
	CalendarClockIcon,
	type LucideIcon,
	MoonIcon,
	OctagonPauseIcon,
} from "lucide-react";
import { scheduleQueries } from "@/features/schedules";
import type { DashboardSummary } from "@/shared/api";
import { dayWord, formatDateTime, formatTime, useNow } from "@/shared/format";
import { PageSection } from "@/shared/page";

const MAX_ITEMS = 5;

type Upcoming = {
	key: string;
	at: number;
	icon: LucideIcon;
	title: string;
	description: string;
	link: Pick<LinkProps, "to" | "params">;
};

/** What happens next on its own: scheduled starts, wake-ups and stop times. */
export function UpNext({
	projectId,
	upNext,
}: {
	projectId: string;
	/** The runs' wake-ups and stop times, the soonest first. */
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
							: "Stop time: no new step starts after it",
					link: { to: "/runs/$runId", params: { runId: item.runId } },
				}) satisfies Upcoming,
		),
	]
		.filter((item) => item.at >= now)
		.sort((a, b) => a.at - b.at)
		.slice(0, MAX_ITEMS);

	return (
		<PageSection
			title="Up next"
			description="Starts, wake-ups and stop times."
			actions={
				<Button
					variant="outline"
					size="sm"
					nativeButton={false}
					render={
						<Link to="/projects/$projectId/schedules" params={{ projectId }} />
					}
				>
					Schedules
					<ArrowRightIcon data-icon="inline-end" />
				</Button>
			}
		>
			<Card size="sm">
				<CardContent>
					{upcoming.length === 0 ? (
						<p className="rounded-md border border-dashed px-4 py-6 text-center text-muted-foreground text-sm">
							Nothing planned. Add a schedule to start a flow at night.
						</p>
					) : (
						<ItemGroup className="gap-1">
							{upcoming.map(
								({ key, at, icon: Icon, title, description, link }) => (
									<Item key={key} size="xs" render={<Link {...link} />}>
										<ItemMedia variant="icon">
											<Icon />
										</ItemMedia>
										<ItemContent className="min-w-0">
											<ItemTitle className="w-full truncate font-mono text-xs">
												{title}
											</ItemTitle>
											<ItemDescription className="truncate text-xs">
												{description}
											</ItemDescription>
										</ItemContent>
										<ItemActions className="text-right text-xs">
											<time
												dateTime={new Date(at).toISOString()}
												title={formatDateTime(at)}
												className="flex flex-col tabular-nums"
											>
												<span>
													<span className="font-medium">{formatTime(at)}</span>{" "}
													<span className="text-muted-foreground">
														{dayWord(at, now)}
													</span>
												</span>
												<span className="text-muted-foreground">
													in {waitedText(at - now)}
												</span>
											</time>
										</ItemActions>
									</Item>
								),
							)}
						</ItemGroup>
					)}
				</CardContent>
			</Card>
		</PageSection>
	);
}
