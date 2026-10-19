import { Button } from "@nightshift/ui/components/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@nightshift/ui/components/table";
import {
	type ColumnDef,
	createColumnHelper,
	createSortedRowModel,
	type Header,
	metaHelper,
	type RowData,
	rowSortingFeature,
	type SortingState,
	tableFeatures,
	useTable,
} from "@tanstack/react-table";
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

type DataTableColumnMeta = {
	/** Classes for the header cell: width, alignment, responsive hiding. */
	headClassName?: string;
	/** Classes for each body cell of the column. */
	cellClassName?: string;
};

/** What every table can do: sort on the columns that opt in. */
const features = tableFeatures({
	rowSortingFeature,
	sortedRowModel: createSortedRowModel(),
	columnMeta: metaHelper<DataTableColumnMeta>(),
});

type Features = typeof features;

/** Typed column definitions for a `DataTable` of `TData` rows. */
export function dataTableColumns<TData extends RowData>() {
	return createColumnHelper<Features, TData>();
}

/**
 * A shadcn Table driven by TanStack Table, after the shadcn Data Table guide.
 * Columns set their classes through `meta`. A column sorts only when it sets
 * `enableSorting: true`; its header then becomes a button.
 */
export function DataTable<TData extends RowData>({
	columns,
	data,
	getRowId,
	initialSorting,
	rowClassName,
	...props
}: {
	// biome-ignore lint/suspicious/noExplicitAny: each column keeps its own value type.
	columns: ColumnDef<Features, TData, any>[];
	data: TData[];
	getRowId: (row: TData) => string;
	initialSorting?: SortingState;
	rowClassName?: (row: TData) => string | undefined;
} & Omit<ComponentProps<typeof Table>, "children">) {
	const table = useTable({
		features,
		columns,
		data,
		getRowId: (row) => getRowId(row),
		defaultColumn: { enableSorting: false },
		enableSortingRemoval: false,
		initialState: initialSorting ? { sorting: initialSorting } : undefined,
	});

	return (
		<Table {...props}>
			<TableHeader>
				{table.getHeaderGroups().map((group) => (
					<TableRow key={group.id} className="hover:bg-transparent">
						{group.headers.map((header) => {
							const sorted = header.column.getIsSorted();
							return (
								<TableHead
									key={header.id}
									className={header.column.columnDef.meta?.headClassName}
									aria-sort={
										header.column.getCanSort()
											? sorted === "asc"
												? "ascending"
												: sorted === "desc"
													? "descending"
													: "none"
											: undefined
									}
								>
									{header.isPlaceholder ? null : header.column.getCanSort() ? (
										<SortButton header={header}>
											<table.FlexRender header={header} />
										</SortButton>
									) : (
										<table.FlexRender header={header} />
									)}
								</TableHead>
							);
						})}
					</TableRow>
				))}
			</TableHeader>
			<TableBody>
				{table.getRowModel().rows.map((row) => (
					<TableRow key={row.id} className={rowClassName?.(row.original)}>
						{row.getAllCells().map((cell) => (
							<TableCell
								key={cell.id}
								className={cell.column.columnDef.meta?.cellClassName}
							>
								<table.FlexRender cell={cell} />
							</TableCell>
						))}
					</TableRow>
				))}
			</TableBody>
		</Table>
	);
}

/** A column header that sorts its column, with the direction as an arrow. */
function SortButton<TData extends RowData>({
	header,
	children,
}: {
	header: Header<Features, TData, unknown>;
	children: ReactNode;
}) {
	const sorted = header.column.getIsSorted();
	return (
		<Button
			variant="ghost"
			size="sm"
			className="-mx-2.5 font-medium"
			onClick={header.column.getToggleSortingHandler()}
		>
			{children}
			{sorted === "asc" ? (
				<ArrowUpIcon data-icon="inline-end" />
			) : sorted === "desc" ? (
				<ArrowDownIcon data-icon="inline-end" />
			) : (
				<ArrowUpDownIcon
					data-icon="inline-end"
					className="text-muted-foreground"
				/>
			)}
		</Button>
	);
}
