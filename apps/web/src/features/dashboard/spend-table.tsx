import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import type { NightsRange } from "@/shared/api";
import { DataTable, dataTableColumns } from "@/shared/data-table";
import { formatCost } from "@/shared/format";
import { CellLines } from "./table-cells";

type SpendGroup = NightsRange["spend"]["groups"][number];

/** A spend group with what it spent each night, oldest first. */
type SpendRow = SpendGroup & { nights: number[] };

/**
 * What each flow spent, the most first: its share of the spend, what it
 * spent each night, what a run costs, and how much went to runs that did
 * not finish. That last part bought nothing.
 */
export function SpendTable({ spend }: { spend: NightsRange["spend"] }) {
	if (spend.groups.length === 0) {
		return (
			<p className="py-6 text-center text-muted-foreground text-sm">
				Nothing spent in this range.
			</p>
		);
	}
	const rows = spend.groups.map(
		(group): SpendRow => ({
			...group,
			nights: spend.perNight.map((night) => night.counts[group.key] ?? 0),
		}),
	);
	return (
		<DataTable
			columns={spendColumns(spend.total)}
			data={rows}
			getRowId={(group) => group.key}
		/>
	);
}

const column = dataTableColumns<SpendRow>();

function spendColumns(total: number) {
	return column.columns([
		column.accessor("label", {
			header: "Flow",
			cell: ({ row: { original } }) => (
				<CellLines
					sub={
						total > 0
							? `${Math.round((original.total / total) * 100)}% of all spend`
							: undefined
					}
				>
					<span className="font-mono">{original.label}</span>
				</CellLines>
			),
			meta: { headClassName: "pl-6", cellClassName: "pl-6" },
		}),
		column.display({
			id: "nights",
			header: "Per night",
			cell: ({ row: { original } }) => <NightBars nights={original.nights} />,
		}),
		column.accessor((group) => group.total / group.runs, {
			id: "perRun",
			header: "Per run",
			enableSorting: true,
			cell: ({ row: { original } }) => (
				<CellLines
					align="end"
					sub={original.runs === 1 ? "1 run" : `${original.runs} runs`}
				>
					<span className="tabular-nums">
						{formatCost(original.total / original.runs)}
					</span>
				</CellLines>
			),
			meta: { headClassName: "text-right", cellClassName: "text-right" },
		}),
		column.accessor("total", {
			header: "Spend",
			enableSorting: true,
			cell: ({ row: { original } }) => (
				<CellLines
					align="end"
					sub={
						original.unfinished > 0
							? `${formatCost(original.unfinished)} on runs that did not finish`
							: undefined
					}
				>
					<span className="font-medium tabular-nums">
						{formatCost(original.total)}
					</span>
				</CellLines>
			),
			meta: {
				headClassName: "w-72 pr-6 text-right",
				cellClassName: "pr-6 text-right",
			},
		}),
	]);
}

const BAR_WIDTH = 3;
const BAR_GAP = 1;
const BARS_HEIGHT = 20;

/**
 * A small bar per night of what a flow spent, oldest first. Each row runs
 * from zero to its own dearest night: one shared scale would squash the
 * cheap flows flat. Their share of the spend says how they compare.
 */
function NightBars({ nights }: { nights: number[] }) {
	const max = Math.max(...nights, 0);
	const spentOn = nights.filter((usd) => usd > 0).length;
	const width = nights.length * (BAR_WIDTH + BAR_GAP);
	return (
		<Tooltip>
			<TooltipTrigger render={<span className="inline-flex" />}>
				<svg
					width={width}
					height={BARS_HEIGHT}
					viewBox={`0 0 ${width} ${BARS_HEIGHT}`}
					aria-hidden="true"
				>
					{nights.map((usd, index) => {
						const height =
							max > 0 && usd > 0 ? Math.max((usd / max) * BARS_HEIGHT, 2) : 1;
						return (
							<rect
								key={index}
								x={index * (BAR_WIDTH + BAR_GAP)}
								y={BARS_HEIGHT - height}
								width={BAR_WIDTH}
								height={height}
								rx={1}
								className={usd > 0 ? "fill-chart-2" : "fill-muted"}
							/>
						);
					})}
				</svg>
			</TooltipTrigger>
			<TooltipContent className="flex flex-col items-start gap-0.5 tabular-nums">
				<span>
					Spent on {spentOn} of {nights.length} nights.
				</span>
				{max > 0 ? (
					<span>The most in one night: {formatCost(max)}.</span>
				) : null}
			</TooltipContent>
		</Tooltip>
	);
}
