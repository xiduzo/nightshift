import { nightsOf } from "@nightshift/client";
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
import { RunStatusIcon } from "@/features/runs";
import type {
	FlowHealthRow,
	NightRange,
	NightsRange,
	Project,
} from "@/shared/api";
import { formatDateTime, formatRelative, useNow } from "@/shared/format";
import { dashboardQueries } from "./queries";

/** How many last runs a project shows. */
const LAST_RUNS = 8;

type LastRun = FlowHealthRow["lastRuns"][number] & { flow: string };

/** Each project and how its last runs ended. A project opens its page. */
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
								render={
									<Link
										to="/projects/$projectId"
										params={{ projectId: project.id }}
										search={{ range }}
									/>
								}
							>
								<ItemContent>
									<ItemTitle>{project.name}</ItemTitle>
									<LastRuns
										runs={lastRunsOf(
											summary ? nightsOf(summary, range) : undefined,
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
function lastRunsOf(nights: NightsRange | undefined): LastRun[] {
	const seen = new Set<string>();
	return (nights?.flows?.rows ?? [])
		.flatMap((flow) =>
			flow.lastRuns.map((run) => ({ ...run, flow: flow.name })),
		)
		.sort((a, b) => b.startedAt - a.startedAt)
		.filter((run) => !seen.has(run.runId) && seen.add(run.runId))
		.slice(0, LAST_RUNS);
}

/** Status icons of the last runs, and when the newest started. */
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
				No runs in the last {range} nights
			</span>
		);
	}
	return (
		<div className="flex flex-col items-start gap-1">
			<div className="flex items-center gap-0.5">
				{runs.map((run) => (
					<span key={run.runId} className="p-0.5">
						<RunStatusIcon
							status={run.status}
							context={{
								before: run.flow,
								after: formatRelative(run.startedAt, now),
							}}
						/>
					</span>
				))}
			</div>
			<time
				dateTime={new Date(last.startedAt).toISOString()}
				title={formatDateTime(last.startedAt)}
				className="text-muted-foreground text-xs"
			>
				Last run {formatRelative(last.startedAt, now)}
			</time>
		</div>
	);
}
