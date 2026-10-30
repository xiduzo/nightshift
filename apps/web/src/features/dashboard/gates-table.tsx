import { waitedText } from "@nightshift/client";
import { Badge } from "@nightshift/ui/components/badge";
import { Progress } from "@nightshift/ui/components/progress";
import { Link } from "@tanstack/react-router";
import type { NightsRange } from "@/shared/api";
import { DataTable, dataTableColumns } from "@/shared/data-table";
import { formatDateTime, formatRelative, useNow } from "@/shared/format";
import { CellLines, MoreRows } from "./table-cells";

type GatesGroup = NightsRange["gates"]["groups"]["rows"][number];

/**
 * The Gates each flow asked, the most asked first: the ones that wait for
 * you now, how many got an answer, and how long an answer takes.
 */
export function GatesTable({
	groups,
}: {
	groups: NightsRange["gates"]["groups"];
}) {
	const now = useNow(60_000);
	if (groups.count === 0) {
		return (
			<p className="py-6 text-center text-muted-foreground text-sm">
				No flow asked you anything in this range.
			</p>
		);
	}
	return (
		<>
			<DataTable
				columns={gateColumns(now)}
				data={groups.rows}
				getRowId={(group) => group.label}
			/>
			<MoreRows hidden={groups.count - groups.rows.length} noun="flow" />
		</>
	);
}

const column = dataTableColumns<GatesGroup>();

function gateColumns(now: number) {
	return column.columns([
		column.accessor("label", {
			header: "Flow",
			cell: ({ row: { original } }) => (
				<CellLines
					sub={
						<time
							dateTime={new Date(original.lastAskedAt).toISOString()}
							title={formatDateTime(original.lastAskedAt)}
						>
							Last asked {formatRelative(original.lastAskedAt, now)}
						</time>
					}
				>
					<span className="font-mono">{original.label}</span>
				</CellLines>
			),
			meta: { headClassName: "pl-6", cellClassName: "pl-6" },
		}),
		column.accessor("waiting", {
			header: "Waits now",
			enableSorting: true,
			cell: ({ row: { original } }) =>
				original.waiting > 0 ? (
					<Badge render={<Link to="/inbox" />}>
						{original.waiting === 1
							? "1 waits for you"
							: `${original.waiting} wait for you`}
					</Badge>
				) : (
					<span className="text-muted-foreground text-xs">Nothing</span>
				),
		}),
		column.accessor((group) => group.answered / group.asked, {
			id: "answered",
			header: "Answered",
			enableSorting: true,
			cell: ({ row: { original } }) => (
				<div className="flex w-40 flex-col gap-1.5">
					<Progress
						value={(original.answered / original.asked) * 100}
						aria-label={`${original.answered} of ${original.asked} answered`}
					/>
					<span className="text-muted-foreground text-xs tabular-nums">
						{original.answered} of {original.asked} answered
						{original.unanswered > 0
							? `, ${original.unanswered} not answered`
							: ""}
					</span>
				</div>
			),
			meta: { headClassName: "w-48" },
		}),
		column.accessor("asked", {
			header: "Asked",
			enableSorting: true,
			cell: ({ row: { original } }) => (
				<CellLines
					align="end"
					sub={original.runs === 1 ? "By 1 run" : `By ${original.runs} runs`}
				>
					<span className="tabular-nums">{original.asked}</span>
				</CellLines>
			),
			meta: {
				headClassName: "text-right",
				cellClassName: "text-right",
			},
		}),
		// Null (none answered) sorts like a missing value: last.
		column.accessor((group) => group.typical ?? undefined, {
			id: "typical",
			header: "Typical answer",
			enableSorting: true,
			sortUndefined: "last",
			cell: ({ row: { original } }) => (
				<CellLines
					align="end"
					sub={
						original.longest === null
							? undefined
							: `Longest ${waitedText(original.longest)}`
					}
				>
					<span className="tabular-nums">
						{original.typical === null ? "—" : waitedText(original.typical)}
					</span>
				</CellLines>
			),
			meta: {
				headClassName: "w-40 pr-6 text-right",
				cellClassName: "pr-6 text-right",
			},
		}),
	]);
}
