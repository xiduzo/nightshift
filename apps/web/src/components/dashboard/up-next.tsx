import { Button } from "@nightshift/ui/components/button";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
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
import { useQuery } from "@tanstack/react-query";
import { Link, type LinkProps } from "@tanstack/react-router";
import {
	ArrowRightIcon,
	CalendarClockIcon,
	type LucideIcon,
	MoonIcon,
	OctagonPauseIcon,
} from "lucide-react";

import { useNow } from "@/hooks/use-now";
import type { RunSummary } from "@/lib/api-types";
import { dayWord, formatDateTime, formatTime } from "@/lib/format";
import { orpc } from "@/utils/orpc";

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
	runs,
}: {
	projectId: string;
	runs: RunSummary[] | undefined;
}) {
	const now = useNow(60_000);
	const schedules = useQuery({
		...orpc.schedules.list.queryOptions({ input: { projectId } }),
		refetchInterval: 30_000,
		meta: { quietRefetchErrors: true },
	});

	const upcoming: Upcoming[] = [
		...(schedules.data?.schedules ?? []).flatMap((schedule) =>
			schedule.enabled && schedule.nextAt
				? [
						{
							key: `schedule:${schedule.id}`,
							at: schedule.nextAt,
							icon: CalendarClockIcon,
							title: schedule.flow,
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
		...(runs ?? []).flatMap((run) => {
			const link = { to: "/runs/$runId", params: { runId: run.id } } as const;
			if (run.status === "sleeping" && run.wakeAt) {
				return [
					{
						key: `wake:${run.id}`,
						at: run.wakeAt,
						icon: MoonIcon,
						title: run.title,
						description: "Wakes and goes on",
						link,
					} satisfies Upcoming,
				];
			}
			if (run.status === "running" && run.stopAt) {
				return [
					{
						key: `stop:${run.id}`,
						at: run.stopAt,
						icon: OctagonPauseIcon,
						title: run.title,
						description: "Stop time: no new step starts after it",
						link,
					} satisfies Upcoming,
				];
			}
			return [];
		}),
	]
		.filter((item) => item.at >= now)
		.sort((a, b) => a.at - b.at)
		.slice(0, MAX_ITEMS);

	return (
		<Card size="sm">
			<CardHeader>
				<CardTitle>
					<h2>Up next</h2>
				</CardTitle>
				<CardDescription>Starts, wake-ups and stop times.</CardDescription>
				<CardAction>
					<Button
						variant="outline"
						size="sm"
						nativeButton={false}
						render={
							<Link
								to="/projects/$projectId/schedules"
								params={{ projectId }}
							/>
						}
					>
						Schedules
						<ArrowRightIcon data-icon="inline-end" />
					</Button>
				</CardAction>
			</CardHeader>
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
											<span className="font-medium">{formatTime(at)}</span>
											<span className="text-muted-foreground">
												{dayWord(at, now)}
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
	);
}
