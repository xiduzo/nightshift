import { daysOf } from "@nightshift/client";
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
	ItemGroup,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { useQueries } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronRightIcon } from "lucide-react";
import { RunBars } from "@/features/runs";
import type {
	FlowHealthRow,
	NightRange,
	NightsRange,
	Project,
} from "@/shared/api";
import { formatRelative, hoverTime, useNow } from "@/shared/format";
import { LocalTime } from "@/shared/time";
import { dashboardQueries } from "./queries";

/** How many last runs a project shows. */
const LAST_RUNS = 8;

type LastRun = FlowHealthRow["lastRuns"][number] & { flow: string };

/** Each project and how its last runs ended. A project opens its page, a run icon its run. */
export function HomeProjects({
	projects,
	range,
}: {
	projects: Project[] | undefined;
	range: NightRange;
}) {
	const now = useNow();
	const summaries = useQueries({
		queries: (projects ?? []).map((project) =>
			dashboardQueries.summary({ projectId: project.id }),
		),
	});
	if (!projects || projects.length === 0) return null;

	return (
		<Card size="sm">
			<CardHeader>
				<CardTitle>Projects</CardTitle>
			</CardHeader>
			<CardContent>
				<ItemGroup className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
					{projects.map((project, index) => {
						const summary = summaries[index]?.data;
						return (
							<Item
								key={project.id}
								variant="outline"
								size="sm"
								className="relative hover:bg-muted/40 has-[a[data-stretched]:focus-visible]:ring-2 has-[a[data-stretched]:focus-visible]:ring-ring/50"
							>
								<ItemContent>
									<ItemTitle>
										{/* The link covers the card, so the card is one target. */}
										<Link
											to="/projects/$projectId"
											params={{ projectId: project.id }}
											search={{ range }}
											data-stretched=""
											className="outline-none after:absolute after:inset-0"
										>
											{project.name}
										</Link>
									</ItemTitle>
									<LastRuns
										runs={lastRunsOf(
											summary ? daysOf(summary, range) : undefined,
										)}
										range={range}
										now={now}
									/>
								</ItemContent>
								<ItemActions>
									<ChevronRightIcon className="size-4 text-muted-foreground" />
								</ItemActions>
							</Item>
						);
					})}
				</ItemGroup>
			</CardContent>
		</Card>
	);
}

/** A project's last runs over all its flows, newest first. */
function lastRunsOf(days: NightsRange | undefined): LastRun[] {
	const seen = new Set<string>();
	return (days?.flows?.rows ?? [])
		.flatMap((flow) =>
			flow.lastRuns.map((run) => ({ ...run, flow: flow.name })),
		)
		.sort((a, b) => b.startedAt - a.startedAt)
		.filter((run) => !seen.has(run.runId) && seen.add(run.runId))
		.slice(0, LAST_RUNS);
}

/** The last runs as bars, oldest on the left, and when the newest started. */
function LastRuns({
	runs,
	range,
	now,
}: {
	runs: LastRun[];
	range: NightRange;
	now: number;
}) {
	const [last] = runs;
	if (!last) {
		return (
			<span className="text-muted-foreground text-xs">
				No runs in the last {range} days
			</span>
		);
	}
	return (
		<div className="flex flex-col items-start gap-1">
			<RunBars
				// Above the card's link: the card opens the project, a bar its run.
				className="relative z-10"
				runs={[...runs].reverse().map((run) => ({
					runId: run.runId,
					status: run.status,
					hint: `${run.flow} · ${hoverTime(run.startedAt)}`,
				}))}
			/>
			<LocalTime at={last.startedAt} className="text-muted-foreground text-xs">
				Last run {formatRelative(last.startedAt, now)}
			</LocalTime>
		</div>
	);
}
