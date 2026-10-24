import { Button } from "@nightshift/ui/components/button";
import {
	Pagination,
	PaginationContent,
	PaginationEllipsis,
	PaginationItem,
	PaginationLink,
	PaginationNext,
	PaginationPrevious,
} from "@nightshift/ui/components/pagination";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@nightshift/ui/components/table";
import { cn } from "@nightshift/ui/lib/utils";
import {
	type ColumnDef,
	createColumnHelper,
	createPaginatedRowModel,
	createSortedRowModel,
	type Header,
	metaHelper,
	type RowData,
	rowPaginationFeature,
	rowSortingFeature,
	type SortingState,
	tableFeatures,
	useTable,
} from "@tanstack/react-table";
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon } from "lucide-react";
import { type ComponentProps, type ReactNode, useEffect } from "react";

type DataTableColumnMeta = {
	/** Classes for the header cell: width, alignment, responsive hiding. */
	headClassName?: string;
	/** Classes for each body cell of the column. */
	cellClassName?: string;
};

/** What every table can do: sort on the columns that opt in, and show its rows in pages. */
const features = tableFeatures({
	rowSortingFeature,
	sortedRowModel: createSortedRowModel(),
	rowPaginationFeature,
	paginatedRowModel: createPaginatedRowModel(),
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
 * `enableSorting: true`; its header then becomes a button. With
 * `onRowClick` a click anywhere on a row calls it. That row still needs a
 * button of its own for the keyboard, and other controls in it stop the click.
 * With `pageSize` it shows that many rows at a time, with page links below.
 */
export function DataTable<TData extends RowData>({
	columns,
	data,
	getRowId,
	initialSorting,
	rowClassName,
	onRowClick,
	pageSize,
	...props
}: {
	// biome-ignore lint/suspicious/noExplicitAny: each column keeps its own value type.
	columns: ColumnDef<Features, TData, any>[];
	data: TData[];
	getRowId: (row: TData) => string;
	initialSorting?: SortingState;
	rowClassName?: (row: TData) => string | undefined;
	onRowClick?: (row: TData) => void;
	/** Rows per page. Without it, every row shows. */
	pageSize?: number;
} & Omit<ComponentProps<typeof Table>, "children">) {
	const table = useTable({
		features,
		columns,
		data,
		getRowId: (row) => getRowId(row),
		defaultColumn: { enableSorting: false },
		enableSortingRemoval: false,
		// A live list refetches often. Stay on the page the person chose.
		autoResetPageIndex: false,
		initialState: {
			...(initialSorting ? { sorting: initialSorting } : {}),
			pagination: {
				pageIndex: 0,
				pageSize: pageSize ?? Number.POSITIVE_INFINITY,
			},
		},
	});

	// When rows go away, the page can end past the last one. Go to the last.
	const pageCount = table.getPageCount();
	const { pageIndex } = table.state.pagination;
	useEffect(() => {
		if (pageCount > 0 && pageIndex >= pageCount) {
			table.setPageIndex(pageCount - 1);
		}
	}, [table, pageIndex, pageCount]);

	return (
		<>
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
						<TableRow
							key={row.id}
							className={cn(
								onRowClick && "cursor-pointer",
								rowClassName?.(row.original),
							)}
							onClick={onRowClick ? () => onRowClick(row.original) : undefined}
						>
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
			{pageCount > 1 ? (
				<Pages
					pageIndex={pageIndex}
					pageCount={pageCount}
					onPage={(index) => table.setPageIndex(index)}
				/>
			) : null}
		</>
	);
}

/**
 * The shadcn Pagination under a table: previous, the page numbers, next.
 * Many pages keep the first, the last and the ones around the current page.
 */
function Pages({
	pageIndex,
	pageCount,
	onPage,
}: {
	pageIndex: number;
	pageCount: number;
	onPage: (index: number) => void;
}) {
	const go = (index: number) => (event: { preventDefault: () => void }) => {
		event.preventDefault();
		if (index >= 0 && index < pageCount) onPage(index);
	};
	const first = pageIndex === 0;
	const last = pageIndex === pageCount - 1;

	return (
		<Pagination className="border-t px-6 py-3 sm:justify-end">
			<PaginationContent>
				<PaginationItem>
					<PaginationPrevious
						href="#"
						onClick={go(pageIndex - 1)}
						aria-disabled={first}
						tabIndex={first ? -1 : undefined}
						className={cn(first && "pointer-events-none opacity-50")}
					/>
				</PaginationItem>
				{pageLinks(pageIndex, pageCount).map((index, i) => (
					<PaginationItem key={index ?? `gap-${i}`}>
						{index === null ? (
							<PaginationEllipsis />
						) : (
							<PaginationLink
								href="#"
								onClick={go(index)}
								isActive={index === pageIndex}
								aria-label={`Page ${index + 1}`}
							>
								{index + 1}
							</PaginationLink>
						)}
					</PaginationItem>
				))}
				<PaginationItem>
					<PaginationNext
						href="#"
						onClick={go(pageIndex + 1)}
						aria-disabled={last}
						tabIndex={last ? -1 : undefined}
						className={cn(last && "pointer-events-none opacity-50")}
					/>
				</PaginationItem>
			</PaginationContent>
		</Pagination>
	);
}

/**
 * The page indexes to link, with `null` for a gap: all of them up to 7,
 * else the first, the last and the current one with its neighbours.
 */
function pageLinks(pageIndex: number, pageCount: number): (number | null)[] {
	if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i);
	const near = new Set([
		0,
		pageCount - 1,
		pageIndex - 1,
		pageIndex,
		pageIndex + 1,
	]);
	const shown = [...near]
		.filter((i) => i >= 0 && i < pageCount)
		.sort((a, b) => a - b);
	return shown.flatMap((index, i) =>
		i > 0 && index - shown[i - 1] > 1 ? [null, index] : [index],
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
