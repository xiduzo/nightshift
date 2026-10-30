/**
 * PROTOTYPE, throw away. Variant A: the flows as a table, like Runs and
 * Schedules. A search and a filter above it. Each row: the flow, how it
 * starts, its last runs, how many finished, Run and a menu. A row opens
 * the editor.
 */

import { Badge } from "@nightshift/ui/components/badge";
import { Card, CardContent } from "@nightshift/ui/components/card";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "@nightshift/ui/components/empty";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
} from "@nightshift/ui/components/input-group";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import {
	ToggleGroup,
	ToggleGroupItem,
} from "@nightshift/ui/components/toggle-group";
import { Link, useNavigate } from "@tanstack/react-router";
import { SearchIcon } from "lucide-react";
import { useState } from "react";
import { DataTable, dataTableColumns } from "@/shared/data-table";
import {
	FinishedCell,
	FlowActions,
	LastRunsStrip,
	ProblemBadge,
	StartsCell,
} from "./flow-parts";
import type { FlowRow } from "./flows-data";
import type { VariantProps } from "./flows-prototype";

type Filter = "all" | "scheduled" | "manual" | "subflow" | "attention";

const FILTERS: {
	value: Filter;
	label: string;
	test: (row: FlowRow) => boolean;
}[] = [
	{ value: "all", label: "All", test: () => true },
	{
		value: "scheduled",
		label: "Scheduled",
		test: (row) => row.start === "schedule" || row.start === "webhook",
	},
	{ value: "manual", label: "By hand", test: (row) => row.start === "manual" },
	{
		value: "subflow",
		label: "Subflows",
		test: (row) => row.start === "subflow",
	},
	{
		value: "attention",
		label: "Need a look",
		test: (row) => row.problem !== null,
	},
];

export function VariantTable({
	projectId,
	rows,
	error,
	healthNights,
	now,
	onRun,
	onDelete,
}: VariantProps) {
	const navigate = useNavigate();
	const [query, setQuery] = useState("");
	const [filter, setFilter] = useState<Filter>("all");

	const test = FILTERS.find((f) => f.value === filter)?.test ?? (() => true);
	const needle = query.trim().toLowerCase();
	const shown = (rows ?? []).filter(
		(row) =>
			test(row) &&
			(needle === "" ||
				row.name.toLowerCase().includes(needle) ||
				(row.flow.description ?? "").toLowerCase().includes(needle)),
	);

	return (
		<Card className="gap-0 py-0">
			<CardContent className="px-0">
				<div className="flex flex-wrap items-center gap-2 border-b px-6 py-3">
					<InputGroup className="w-full sm:w-64">
						<InputGroupAddon>
							<SearchIcon aria-hidden="true" />
						</InputGroupAddon>
						<InputGroupInput
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder="Search flows"
							aria-label="Search flows"
						/>
					</InputGroup>
					<ToggleGroup
						variant="outline"
						size="sm"
						spacing={0}
						value={[filter]}
						onValueChange={(next) => {
							const [value] = next as Filter[];
							if (value) setFilter(value);
						}}
					>
						{FILTERS.map((f) => {
							const count = (rows ?? []).filter(f.test).length;
							return (
								<ToggleGroupItem key={f.value} value={f.value}>
									{f.label}
									{f.value !== "all" && count > 0 ? (
										<Badge
											variant={
												f.value === "attention" ? "destructive" : "secondary"
											}
											className="tabular-nums"
										>
											{count}
										</Badge>
									) : null}
								</ToggleGroupItem>
							);
						})}
					</ToggleGroup>
				</div>

				{!rows ? (
					<div className="flex flex-col gap-2 px-6 py-4">
						<Skeleton className="h-10 w-full" />
						<Skeleton className="h-10 w-full" />
						<Skeleton className="h-10 w-full" />
					</div>
				) : shown.length === 0 ? (
					<Empty>
						<EmptyHeader>
							<EmptyTitle>No flows match</EmptyTitle>
							<EmptyDescription>
								{error?.message ?? "Try another search or filter."}
							</EmptyDescription>
						</EmptyHeader>
					</Empty>
				) : (
					<DataTable
						columns={flowColumns({
							projectId,
							now,
							healthNights,
							onRun,
							onDelete,
						})}
						data={shown}
						getRowId={(row) => row.name}
						initialSorting={[{ id: "name", desc: false }]}
						onRowClick={(row) =>
							void navigate({
								to: "/projects/$projectId/flows/$name",
								params: { projectId, name: row.name },
							})
						}
					/>
				)}
			</CardContent>
		</Card>
	);
}

const column = dataTableColumns<FlowRow>();

function flowColumns({
	projectId,
	now,
	healthNights,
	onRun,
	onDelete,
}: Pick<
	VariantProps,
	"projectId" | "now" | "healthNights" | "onRun" | "onDelete"
>) {
	return column.columns([
		column.accessor("name", {
			header: "Flow",
			enableSorting: true,
			cell: ({ row: { original: row } }) => (
				<div className="flex min-w-0 flex-col gap-1">
					<div className="flex min-w-0 items-center gap-2">
						<Link
							to="/projects/$projectId/flows/$name"
							params={{ projectId, name: row.name }}
							onClick={(event) => event.stopPropagation()}
							className="truncate font-medium font-mono hover:underline"
						>
							{row.name}
						</Link>
						<ProblemBadge problem={row.problem} />
					</div>
					<p className="line-clamp-1 whitespace-normal text-muted-foreground text-xs">
						{row.flow.description ?? "No description"}
					</p>
					{row.flow.inputs.length > 0 ? (
						<p className="truncate font-mono text-muted-foreground text-xs">
							{row.flow.inputs
								.map((input) => `${input.name}${input.required ? "" : "?"}`)
								.join(", ")}
						</p>
					) : null}
				</div>
			),
			meta: {
				headClassName: "pl-6",
				cellClassName: "w-2/5 max-w-0 py-3 pl-6 align-top",
			},
		}),
		column.accessor((row) => row.next?.nextAt ?? undefined, {
			id: "starts",
			header: "Starts",
			enableSorting: true,
			sortUndefined: "last",
			cell: ({ row }) => <StartsCell row={row.original} now={now} />,
			meta: {
				headClassName: "hidden md:table-cell",
				cellClassName: "hidden max-w-64 py-3 align-top md:table-cell",
			},
		}),
		column.accessor((row) => row.health?.last?.startedAt, {
			id: "last",
			header: "Last runs",
			enableSorting: true,
			sortUndefined: "last",
			cell: ({ row }) => <LastRunsStrip row={row.original} now={now} />,
			meta: {
				headClassName: "hidden lg:table-cell",
				cellClassName: "hidden py-3 align-top lg:table-cell",
			},
		}),
		column.accessor((row) => row.health?.rate ?? undefined, {
			id: "rate",
			header: healthNights ? `Finished, ${healthNights} nights` : "Finished",
			enableSorting: true,
			sortUndefined: "last",
			cell: ({ row }) => <FinishedCell row={row.original} />,
			meta: {
				headClassName: "hidden xl:table-cell",
				cellClassName: "hidden py-3 align-top xl:table-cell",
			},
		}),
		column.display({
			id: "actions",
			header: () => <span className="sr-only">Actions</span>,
			cell: ({ row }) => (
				<FlowActions
					projectId={projectId}
					row={row.original}
					onRun={() => onRun(row.original)}
					onDelete={() => onDelete(row.original)}
				/>
			),
			meta: {
				headClassName: "w-0 pr-6",
				cellClassName: "w-0 py-3 pr-6 align-top",
			},
		}),
	]);
}
