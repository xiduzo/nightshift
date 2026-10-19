import { Button } from "@nightshift/ui/components/button";
import { Card, CardContent } from "@nightshift/ui/components/card";
import { Progress } from "@nightshift/ui/components/progress";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRightIcon } from "lucide-react";
import { DataTable, dataTableColumns } from "@/components/data-table";
import { PageSection } from "@/components/page-heading";
import { RunStatusBadge } from "@/components/run-status-badge";
import { useNow } from "@/hooks/use-now";
import type { RunSummary } from "@/lib/api-types";
import { formatCost, formatDateTime, formatRelative } from "@/lib/format";
import { inLastNights } from "@/lib/nights";
import { orpc } from "@/utils/orpc";

const NIGHTS = 30;

/**
 * Each flow over the last 30 nights: its last run, how often it finished, and
 * what a run costs. A stopped run does not count against it: a person ended it.
 */
export function FlowHealth({
	projectId,
	runs,
}: {
	projectId: string;
	runs: RunSummary[] | undefined;
}) {
	const now = useNow(60_000);
	const flows = useQuery(
		orpc.flows.list.queryOptions({ input: { projectId } }),
	);

	if (!flows.isLoading && (flows.data?.length ?? 0) === 0) return null;

	return (
		<PageSection
			title="Flow health"
			description={`Each flow over the last ${NIGHTS} nights.`}
			actions={
				<Button
					variant="outline"
					size="sm"
					nativeButton={false}
					render={
						<Link to="/projects/$projectId/flows" params={{ projectId }} />
					}
				>
					Flows
					<ArrowRightIcon data-icon="inline-end" />
				</Button>
			}
		>
			<Card className="py-0">
				<CardContent className="px-0">
					{flows.isLoading || !runs ? (
						<div className="flex flex-col gap-2 px-6 py-4">
							<Skeleton className="h-9 w-full" />
							<Skeleton className="h-9 w-full" />
						</div>
					) : (
						<DataTable
							columns={flowHealthColumns(projectId, now)}
							data={(flows.data ?? []).map((flow) =>
								flowHealthOf(flow.name, runs, now),
							)}
							getRowId={(row) => row.name}
						/>
					)}
				</CardContent>
			</Card>
		</PageSection>
	);
}

type FlowHealthRow = {
	name: string;
	last: RunSummary | undefined;
	/** Runs in the last nights. */
	runs: number;
	finished: number;
	ended: number;
	/** Percent of ended runs that finished; undefined when none ended. */
	rate: number | undefined;
	perRun: number | undefined;
};

function flowHealthOf(
	name: string,
	runs: RunSummary[],
	now: number,
): FlowHealthRow {
	const mine = runs.filter((run) => run.flowName === name);
	const last = mine.reduce<RunSummary | undefined>(
		(latest, run) =>
			latest === undefined || run.createdAt > latest.createdAt ? run : latest,
		undefined,
	);
	const recent = mine.filter((run) => inLastNights(run.createdAt, NIGHTS, now));
	const finished = recent.filter((run) => run.status === "finished").length;
	const ended = recent.filter(
		(run) =>
			run.status === "finished" ||
			run.status === "failed" ||
			run.status === "interrupted",
	).length;
	const cost = recent.reduce((sum, run) => sum + run.costUsd, 0);
	return {
		name,
		last,
		runs: recent.length,
		finished,
		ended,
		rate: ended > 0 ? Math.round((finished / ended) * 100) : undefined,
		perRun: recent.length > 0 ? cost / recent.length : undefined,
	};
}

const column = dataTableColumns<FlowHealthRow>();

function flowHealthColumns(projectId: string, now: number) {
	return column.columns([
		column.accessor("name", {
			header: "Flow",
			cell: ({ row }) => (
				<Link
					to="/projects/$projectId/flows/$name"
					params={{ projectId, name: row.original.name }}
					className="font-medium font-mono text-xs underline-offset-4 hover:underline"
				>
					{row.original.name}
				</Link>
			),
			meta: { headClassName: "pl-6", cellClassName: "pl-6" },
		}),
		column.accessor((row) => row.last?.createdAt, {
			id: "last",
			header: "Last run",
			enableSorting: true,
			sortUndefined: "last",
			cell: ({ row: { original } }) =>
				original.last ? (
					<span className="flex items-center gap-2">
						<RunStatusBadge status={original.last.status} />
						<Link
							to="/runs/$runId"
							params={{ runId: original.last.id }}
							className="text-muted-foreground text-xs underline-offset-4 hover:underline"
						>
							<time
								dateTime={new Date(original.last.createdAt).toISOString()}
								title={formatDateTime(original.last.createdAt)}
							>
								{formatRelative(original.last.createdAt, now)}
							</time>
						</Link>
					</span>
				) : (
					<span className="text-muted-foreground text-xs">Never run</span>
				),
		}),
		column.accessor("rate", {
			header: "Finished",
			enableSorting: true,
			sortUndefined: "last",
			cell: ({ row: { original } }) =>
				original.rate === undefined ? (
					<span className="text-muted-foreground text-xs">—</span>
				) : (
					<span
						className="flex items-center gap-2"
						title={`${original.finished} of ${original.ended} finished. Stopped runs do not count.`}
					>
						<Progress
							value={original.rate}
							aria-label={`${original.rate}% finished`}
							className="w-24"
						/>
						<span className="text-xs tabular-nums">{original.rate}%</span>
					</span>
				),
			meta: { headClassName: "w-48" },
		}),
		column.accessor("runs", {
			header: "Runs",
			enableSorting: true,
			meta: {
				headClassName: "text-right",
				cellClassName: "text-right tabular-nums",
			},
		}),
		column.accessor("perRun", {
			header: "Per run",
			enableSorting: true,
			sortUndefined: "last",
			cell: ({ row }) =>
				row.original.perRun === undefined
					? "—"
					: formatCost(row.original.perRun),
			meta: {
				headClassName: "pr-6 text-right",
				cellClassName: "pr-6 text-right tabular-nums",
			},
		}),
	]);
}
