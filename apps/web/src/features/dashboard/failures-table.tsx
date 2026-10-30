import { Link } from "@tanstack/react-router";
import { CostText, RunStatusIcon } from "@/features/runs";
import type { NightsRange } from "@/shared/api";
import { DataTable, dataTableColumns } from "@/shared/data-table";
import { formatDateTime, formatRelative, useNow } from "@/shared/format";
import { CellLines, MoreRows } from "./table-cells";

type FailedRun = NightsRange["runs"]["failed"]["rows"][number];

/**
 * The runs that failed, newest first: why, what they spent, and how their
 * flow did after. A flow that finished since needs no help. One that failed
 * again, or did not run since, does.
 */
export function FailuresTable({
	failed,
	nights,
}: {
	failed: NightsRange["runs"]["failed"];
	nights: number;
}) {
	const now = useNow(60_000);
	if (failed.count === 0) {
		return (
			<p className="py-6 text-center text-muted-foreground text-sm">
				No run failed in the last {nights} nights.
			</p>
		);
	}
	return (
		<>
			<DataTable
				columns={failureColumns(now)}
				data={failed.rows}
				getRowId={(run) => run.id}
			/>
			<MoreRows hidden={failed.count - failed.rows.length} noun="failed run" />
		</>
	);
}

const column = dataTableColumns<FailedRun>();

function failureColumns(now: number) {
	return column.columns([
		column.accessor("title", {
			header: "Run",
			cell: ({ row: { original } }) => (
				<CellLines
					sub={
						<>
							<span className="font-mono">{original.group}</span>
							{", "}
							<time
								dateTime={new Date(original.createdAt).toISOString()}
								title={formatDateTime(original.createdAt)}
							>
								{formatRelative(original.createdAt, now)}
							</time>
						</>
					}
				>
					<Link
						to="/runs/$runId"
						params={{ runId: original.id }}
						className="font-medium hover:underline"
					>
						{original.title}
					</Link>
				</CellLines>
			),
			meta: { headClassName: "pl-6", cellClassName: "max-w-64 pl-6" },
		}),
		column.accessor("reason", {
			header: "Why it failed",
			cell: ({ row: { original } }) => (
				<span
					className="line-clamp-2 whitespace-normal text-muted-foreground text-xs"
					title={original.reason ?? undefined}
				>
					{original.reason ?? "No reason given"}
				</span>
			),
			meta: { cellClassName: "max-w-md" },
		}),
		column.accessor((run) => run.after.last?.createdAt, {
			id: "since",
			header: "Since then",
			enableSorting: true,
			sortUndefined: "last",
			cell: ({ row: { original } }) => (
				<SinceThen after={original.after} now={now} />
			),
			meta: { headClassName: "w-48" },
		}),
		column.accessor("costUsd", {
			header: "Spent",
			enableSorting: true,
			cell: ({ row: { original } }) => <CostText cost={original} />,
			meta: {
				headClassName: "w-24 pr-6 text-right",
				cellClassName: "pr-6 text-right tabular-nums",
			},
		}),
	]);
}

/** How the flow did after the failure: the newest later run, and how many finished. */
function SinceThen({ after, now }: { after: FailedRun["after"]; now: number }) {
	const { last } = after;
	if (!last) {
		return (
			<CellLines sub="Start it again to see if it works now.">
				Not run since
			</CellLines>
		);
	}
	const label =
		last.status === "finished"
			? "Finished since"
			: last.status === "failed"
				? "Failed again"
				: last.status === "stopped"
					? "Stopped since"
					: "Runs again now";
	return (
		<CellLines
			sub={
				after.runs === 1
					? `1 run since, ${formatRelative(last.createdAt, now)}`
					: `${after.finished} of ${after.runs} runs since finished`
			}
		>
			<span className="inline-flex items-center gap-1.5">
				<RunStatusIcon status={last.status} />
				{label}
			</span>
		</CellLines>
	);
}
