/**
 * Where the work of a flow landed (Q31): the work ladder (agents, subflows,
 * Values by a model, Asks) and the choice ladder (Decisions). A landing is
 * one time a node's work or choice came to rest, on a rung: a tier, a rule,
 * you, its deadline, or nowhere. Flow health shows it as its first column,
 * and its details as the Ladders tab.
 */
import {
	decisionsText,
	type LadderPart,
	type LadderSummary,
	ladderParts,
	landedText,
	type NodeLadder,
	nodeLadderLabel,
	shareText,
	unsureText,
} from "@nightshift/client";
import { Badge } from "@nightshift/ui/components/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@nightshift/ui/components/card";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import { cn } from "@nightshift/ui/lib/utils";
import type { FlowHealthRow, FlowRange, NightRange } from "@/shared/api";
import { DataTable, dataTableColumns } from "@/shared/data-table";
import { formatKnownCost } from "@/shared/format";
import { ChartSection, DetailsEmpty, MoreRows, Swatch } from "./details";

/** What an older Host shows instead. */
const UPDATE_HINT = "Update Night Shift to see where the work landed.";

/** The fill of each rung (index.css `--ladder-*`). */
const RUNG_FILL: Record<LadderPart["rung"], string> = {
	rule: "bg-ladder-rule",
	first: "bg-ladder-first",
	later: "bg-ladder-later",
	person: "bg-ladder-person",
	deadline: "bg-ladder-deadline",
	none: "bg-ladder-none",
};

/** The color of a rung, for a swatch. */
function rungColor(part: LadderPart): string {
	return `var(--ladder-${part.rung})`;
}

/**
 * A thin segmented bar: one part per rung in ladder order, as wide as its
 * share. Its name says every part, for a screen reader.
 */
function LadderBar({
	parts,
	className,
}: {
	parts: LadderPart[];
	className?: string;
}) {
	return (
		<span
			role="img"
			aria-label={parts.map((part) => `${part.label} ${part.share}`).join(", ")}
			className={cn("flex h-2 gap-0.5", className)}
		>
			{parts.map((part) => (
				<span
					key={part.key}
					className={cn("min-w-1 rounded-full", RUNG_FILL[part.rung])}
					style={{ flex: `${part.landed} 0 0` }}
				/>
			))}
		</span>
	);
}

/** The rungs of one ladder for a tooltip: how often, and what a landing cost. */
function RungLines({
	title,
	summary,
	count,
}: {
	title: string;
	summary: LadderSummary;
	count: (landed: number, of: number) => string;
}) {
	return (
		<>
			<span className="font-medium">{title}</span>
			{ladderParts(summary).map((part) => (
				<span key={part.key} className="flex items-center gap-1.5">
					<Swatch color={rungColor(part)} />
					{part.label}: {count(part.landed, summary.landed)},{" "}
					{formatKnownCost(part.costPerLanding)} each
				</span>
			))}
		</>
	);
}

/**
 * Flow health's first column: one bar for the work and one for the
 * choices, each with its shares in a line. The tooltip gives what a
 * landing on each rung cost, and how sure the deciders were. An older Host
 * sends nothing: a dash.
 */
export function LaddersCell({
	ladders,
}: {
	ladders: FlowHealthRow["ladders"];
}) {
	if (!ladders || (!ladders.work && !ladders.choice)) {
		return (
			<Tooltip>
				<TooltipTrigger render={<span className="text-muted-foreground" />}>
					—
				</TooltipTrigger>
				<TooltipContent className="max-w-64">
					{ladders
						? "No agent, subflow or Decision ran in these days."
						: UPDATE_HINT}
				</TooltipContent>
			</Tooltip>
		);
	}
	const { work, choice } = ladders;
	const unsure = choice ? unsureText(choice) : null;
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<span className="grid min-w-56 grid-cols-[auto_4rem_minmax(0,1fr)] items-center gap-x-2 gap-y-1.5 text-xs" />
				}
			>
				{work ? <LadderLine label="Work" summary={work} /> : null}
				{choice ? <LadderLine label="Choices" summary={choice} /> : null}
			</TooltipTrigger>
			<TooltipContent className="flex max-w-80 flex-col items-start gap-0.5 tabular-nums">
				{work ? (
					<RungLines title="Work" summary={work} count={landedText} />
				) : null}
				{choice ? (
					<RungLines title="Choices" summary={choice} count={decisionsText} />
				) : null}
				{unsure ? <span>{unsure}</span> : null}
				<span className="text-muted-foreground">
					Each cost includes the tries before it.
				</span>
			</TooltipContent>
		</Tooltip>
	);
}

/** One ladder in a table cell: its name, its bar and its shares. */
function LadderLine({
	label,
	summary,
}: {
	label: string;
	summary: LadderSummary;
}) {
	return (
		<>
			<span className="text-muted-foreground">{label}</span>
			<LadderBar parts={ladderParts(summary)} />
			<span className="whitespace-normal">{shareText(summary)}</span>
		</>
	);
}

/**
 * The Ladders tab: a card per ladder with each rung, its share, how often
 * work landed on it and what a landing there cost, then the nodes that
 * landed most.
 */
export function Ladders({
	ladders,
	range,
}: {
	ladders: FlowRange["ladders"];
	range: NightRange;
}) {
	if (!ladders) return <DetailsEmpty>{UPDATE_HINT}</DetailsEmpty>;
	if (!ladders.work && !ladders.choice) {
		return (
			<DetailsEmpty>
				No agent, subflow or Decision ran in the last {range} days.
			</DetailsEmpty>
		);
	}
	const unsure = ladders.choice ? unsureText(ladders.choice) : null;
	return (
		<>
			<div className="grid gap-3 sm:grid-cols-2">
				<LadderCard
					title="Work"
					summary={ladders.work}
					unit="Times"
					count={(landed) => `${landed} ${landed === 1 ? "time" : "times"}`}
					empty="No agent or subflow ran in these days."
				/>
				<LadderCard
					title="Choices"
					summary={ladders.choice}
					unit="Decisions"
					count={(landed) =>
						`${landed} ${landed === 1 ? "Decision" : "Decisions"}`
					}
					empty="No Decision ran in these days."
					footer={unsure}
				/>
			</div>
			<NodeLadders nodes={ladders.nodes} />
		</>
	);
}

/** One ladder: its bar, then each rung with its share, its count and its cost. */
function LadderCard({
	title,
	summary,
	unit,
	count,
	empty,
	footer,
}: {
	title: string;
	summary: LadderSummary | null;
	/** The header of the count column. */
	unit: string;
	/** "41 times". */
	count: (landed: number) => string;
	empty: string;
	footer?: string | null;
}) {
	return (
		<Card size="sm">
			<CardHeader>
				<CardTitle>{title}</CardTitle>
				<CardDescription className="text-xs">
					{summary ? count(summary.landed) : empty}
				</CardDescription>
			</CardHeader>
			{summary ? (
				<CardContent className="flex flex-col gap-3">
					<LadderBar parts={ladderParts(summary)} />
					<DataTable
						columns={rungColumns(unit)}
						data={ladderParts(summary)}
						getRowId={(part) => part.key}
					/>
				</CardContent>
			) : null}
			{footer ? (
				<CardFooter className="text-muted-foreground text-xs">
					{footer}
				</CardFooter>
			) : null}
		</Card>
	);
}

const rungColumn = dataTableColumns<LadderPart>();

function rungColumns(unit: string) {
	const number = {
		headClassName: "text-right",
		cellClassName: "text-right tabular-nums",
	};
	return rungColumn.columns([
		rungColumn.accessor("label", {
			header: "Rung",
			cell: ({ row: { original } }) => (
				<span className="flex items-center gap-2">
					<Swatch color={rungColor(original)} />
					{original.label}
				</span>
			),
		}),
		rungColumn.accessor("share", { header: "Share", meta: number }),
		rungColumn.accessor("landed", { header: unit, meta: number }),
		rungColumn.accessor((part) => part.costPerLanding.costUsd, {
			id: "each",
			header: "Cost each",
			cell: ({ row: { original } }) => formatKnownCost(original.costPerLanding),
			meta: number,
		}),
	]);
}

/** The nodes that landed most, the most first, each with its own bar. */
function NodeLadders({
	nodes,
}: {
	nodes: NonNullable<FlowRange["ladders"]>["nodes"];
}) {
	if (nodes.rows.length === 0) return null;
	return (
		<ChartSection
			title="By node"
			hint={`The top ${nodes.rows.length}, the busiest first`}
		>
			<DataTable
				columns={nodeColumns}
				data={nodes.rows}
				getRowId={(node) => node.key}
			/>
			<MoreRows hidden={nodes.count - nodes.rows.length} where="nodes" />
		</ChartSection>
	);
}

const nodeColumn = dataTableColumns<NodeLadder>();

const nodeColumns = nodeColumn.columns([
	nodeColumn.accessor(nodeLadderLabel, {
		id: "node",
		header: "Node",
		cell: ({ row: { original } }) => (
			<span className="flex items-center gap-2">
				<span className="font-mono text-xs">{nodeLadderLabel(original)}</span>
				<Badge variant="outline">
					{original.ladder === "work" ? "Work" : "Choice"}
				</Badge>
			</span>
		),
	}),
	nodeColumn.accessor((node) => node.rungs.length, {
		id: "landed-on",
		header: "Where it landed",
		cell: ({ row: { original } }) => {
			const summary = { landed: original.landed, rungs: original.rungs };
			return (
				<span className="grid min-w-48 grid-cols-[4rem_minmax(0,1fr)] items-center gap-2 text-xs">
					<LadderBar parts={ladderParts(summary)} />
					<span className="whitespace-normal">{shareText(summary)}</span>
				</span>
			);
		},
	}),
	nodeColumn.accessor("landed", {
		header: "Times",
		enableSorting: true,
		meta: {
			headClassName: "text-right w-20",
			cellClassName: "text-right tabular-nums",
		},
	}),
	nodeColumn.accessor((node) => node.costPerLanding.costUsd, {
		id: "each",
		header: "Cost each",
		enableSorting: true,
		cell: ({ row: { original } }) => formatKnownCost(original.costPerLanding),
		meta: {
			headClassName: "text-right w-28",
			cellClassName: "text-right tabular-nums",
		},
	}),
]);
