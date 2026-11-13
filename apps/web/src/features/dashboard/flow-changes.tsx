import { changeSummary, isMissingOnHost } from "@nightshift/client";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@nightshift/ui/components/card";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { CircleAlertIcon, HourglassIcon } from "lucide-react";
import type { FlowHealthRow, NightRange, Project } from "@/shared/api";
import { formatRelative, useNow } from "@/shared/format";
import { BeforeAfter } from "./before-after";
import { ChangeTimeline } from "./change-timeline";
import { NextChanges } from "./next-changes";
import { dashboardQueries } from "./queries";

/**
 * An opened flow row: what your changes to the flow did, and what to
 * change next. On top, the runs on a line in time with each change of
 * the flow. Under it, one table: the runs since your last change against
 * the runs before it, and the days against as many days before. Beside it,
 * the next changes to try, each with an agent that proposes the change.
 */
export function FlowChanges({
	project,
	row,
	range,
}: {
	project: Project;
	row: FlowHealthRow;
	range: NightRange;
}) {
	const now = useNow(60_000);
	const changes = useQuery(
		dashboardQueries.changes(project.id, row.name, range),
	);

	if (changes.isPending) {
		return (
			<div className="flex flex-col gap-3 bg-muted/30 px-4 py-4 pl-13">
				<Skeleton className="h-12 w-full" />
				<Skeleton className="h-48 w-full" />
			</div>
		);
	}
	if (changes.isError) {
		return (
			<div className="bg-muted/30 px-4 py-4 pl-13">
				<Alert>
					<CircleAlertIcon />
					<AlertTitle>
						{isMissingOnHost(changes.error)
							? "Update Night Shift on your Host to see this"
							: "Night Shift could not compare the runs of this flow"}
					</AlertTitle>
					<AlertDescription>
						{isMissingOnHost(changes.error)
							? "Your Host runs an older Night Shift."
							: "Open the row again in a moment."}
					</AlertDescription>
				</Alert>
			</div>
		);
	}

	const data = changes.data;
	const { pending } = data;
	return (
		<div className="flex flex-col gap-4 bg-muted/30 px-4 py-4 pl-13">
			<ChangeTimeline changes={data} now={now} />
			<div className="grid items-start gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
				<Card size="sm">
					<CardHeader>
						<CardTitle>Before and after</CardTitle>
						<CardDescription>
							What changed since your last change, and since the {range} days
							before.
						</CardDescription>
					</CardHeader>
					<CardContent className="flex flex-col gap-3">
						{pending ? (
							<Alert>
								<HourglassIcon />
								<AlertTitle>
									You changed the flow {formatRelative(pending.at, now)}
								</AlertTitle>
								<AlertDescription>
									{changeSummary(pending)}. No run since. The next runs show its
									effect. Until then, the table shows your change before it.
								</AlertDescription>
							</Alert>
						) : null}
						<BeforeAfter changes={data} now={now} />
					</CardContent>
				</Card>
				<Card size="sm">
					<CardHeader>
						<CardTitle>The next change to try</CardTitle>
						<CardDescription>
							Make one change at a time. Its effect shows in the table after the
							next runs.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<NextChanges project={project} flow={row.name} moves={data.moves} />
					</CardContent>
				</Card>
			</div>
			<span className="text-muted-foreground text-xs">
				The next changes come from the last {data.read}{" "}
				{data.read === 1 ? "run" : "runs"} of these days.
			</span>
		</div>
	);
}
