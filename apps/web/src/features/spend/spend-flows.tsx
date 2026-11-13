import {
	nodeLadderLabel,
	type SpendDays,
	type SpendFlow,
	savingTitle,
	savingWhy,
} from "@nightshift/client";
import { Button } from "@nightshift/ui/components/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@nightshift/ui/components/collapsible";
import { Progress } from "@nightshift/ui/components/progress";
import { cn } from "@nightshift/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { ChevronRightIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { formatCost } from "@/shared/format";
import { STRIP_TIMES } from "@/shared/spread-strip";
import { CostStrip, CostStripLegend, STRIP_MARKS } from "./cost-strip";
import { SteadinessBadge } from "./steadiness";
import { SavingActions } from "./ways-to-save";

const GRID =
	"grid grid-cols-[1.25rem_minmax(11rem,1.3fr)_13.75rem_8.5rem_5rem_5.5rem] items-center gap-4 px-3";

/**
 * Each flow that cost money over the page's range, the most spend first:
 * what its runs cost against a usual run of that flow, how steady that
 * is, what it spent and what a change could save. A row opens in place:
 * what each step costs, and the ways to save on that flow. The flows that
 * cost nothing share one row, and so do the quick runs.
 */
export function SpendFlows({
	days,
	projectName,
}: {
	days: SpendDays;
	/** Undefined for a project that is gone. */
	projectName: (projectId: string) => string | undefined;
}) {
	const [openKey, setOpenKey] = useState<string>();
	const paid = days.flows.filter((flow) => flow.spent > 0);
	const free = days.flows.filter((flow) => flow.spent <= 0);
	return (
		<div className="overflow-x-auto">
			<div className="min-w-[52rem]">
				<div
					className={cn(
						GRID,
						"border-b py-2 font-medium text-muted-foreground text-xs",
					)}
				>
					<span />
					<span>Flow</span>
					<span className="flex justify-between font-normal tabular-nums">
						{STRIP_MARKS.map((times) => (
							<span
								key={times}
								className={times === 1 ? "font-semibold text-foreground" : ""}
							>
								{times}×{times === STRIP_TIMES ? "+" : ""}
							</span>
						))}
					</span>
					<span>Cost is</span>
					<span className="text-right">Spent</span>
					<span className="text-right">Could save</span>
				</div>
				{paid.map((flow) => {
					const open = openKey === flow.key;
					const project = projectName(flow.projectId);
					return (
						<Collapsible
							key={flow.key}
							open={open}
							onOpenChange={(next) => setOpenKey(next ? flow.key : undefined)}
							className="border-b"
						>
							<CollapsibleTrigger
								className={cn(
									GRID,
									"w-full cursor-pointer py-3 text-left text-sm outline-none hover:bg-muted/50 focus-visible:bg-muted/50",
									open && "bg-muted/50",
								)}
							>
								<ChevronRightIcon
									className={cn(
										"size-4 text-muted-foreground transition-transform",
										open && "rotate-90",
									)}
									aria-hidden="true"
								/>
								<span className="flex min-w-0 flex-col gap-0.5">
									<span className="truncate font-medium font-mono">
										{flow.flow}
									</span>
									<span className="truncate text-muted-foreground text-xs">
										{[
											project ?? "Removed project",
											flow.usual
												? `usual ${formatCost(flow.usual.median)}`
												: `${flow.runs} ${flow.runs === 1 ? "run" : "runs"}`,
										].join(" · ")}
									</span>
								</span>
								<CostStrip flow={flow} />
								<span>
									{flow.steadiness ? (
										<SteadinessBadge steadiness={flow.steadiness} />
									) : null}
								</span>
								<span className="text-right font-medium tabular-nums">
									{formatCost(flow.spent)}
								</span>
								<Saves usd={flow.saves} />
							</CollapsibleTrigger>
							<CollapsibleContent>
								{open ? (
									<FlowDetail
										flow={flow}
										savings={days.savings.filter(
											(saving) =>
												saving.projectId === flow.projectId &&
												saving.flow === flow.flow,
										)}
										linked={project !== undefined}
									/>
								) : null}
							</CollapsibleContent>
						</Collapsible>
					);
				})}
				{days.quick.spent > 0 ? (
					<PlainRow
						title="Quick runs"
						sub={`${days.quick.runs} ${days.quick.runs === 1 ? "run" : "runs"} without a flow`}
						spent={formatCost(days.quick.spent)}
					/>
				) : null}
				{free.length > 0 ? (
					<PlainRow
						title={`${free.length} ${free.length === 1 ? "flow" : "flows"} that cost nothing`}
						sub={free.map((flow) => flow.flow).join(", ")}
						spent={formatCost(0)}
					/>
				) : null}
				<div className={cn(GRID, "border-b py-3 text-sm")}>
					<span />
					<span className="flex flex-col gap-0.5">
						<span className="font-semibold">
							Total in the last {days.nights} days
						</span>
						<span className="text-muted-foreground text-xs tabular-nums">
							{days.runs} {days.runs === 1 ? "run" : "runs"}
						</span>
					</span>
					<span />
					<span />
					<span className="text-right font-semibold tabular-nums">
						{formatCost(days.total)}
					</span>
					<span
						className={cn(
							"text-right font-semibold tabular-nums",
							days.saves > 0 ? "text-status-finished" : "text-muted-foreground",
						)}
					>
						{days.saves > 0 ? formatCost(days.saves) : "—"}
					</span>
				</div>
				<div className="px-3 pt-3">
					<CostStripLegend />
				</div>
			</div>
		</div>
	);
}

function Saves({ usd }: { usd: number }) {
	return usd > 0 ? (
		<span className="text-right font-medium tabular-nums">
			{formatCost(usd)}
		</span>
	) : (
		<span className="text-right text-muted-foreground">—</span>
	);
}

/** A row that does not open: the quick runs, or the flows that cost nothing. */
function PlainRow({
	title,
	sub,
	spent,
}: {
	title: string;
	sub: string;
	spent: ReactNode;
}) {
	return (
		<div className={cn(GRID, "border-b py-3 text-sm")}>
			<span />
			<span className="col-span-3 flex min-w-0 flex-col gap-0.5">
				<span>{title}</span>
				<span className="truncate text-muted-foreground text-xs">{sub}</span>
			</span>
			<span className="text-right font-medium tabular-nums">{spent}</span>
			<span className="text-right text-muted-foreground">—</span>
		</div>
	);
}

/**
 * The opened row: what each step of the flow costs per run, the dearest
 * first, then the ways to save on this flow, and the way to the flow.
 */
function FlowDetail({
	flow,
	savings,
	linked,
}: {
	flow: SpendFlow;
	savings: SpendDays["savings"];
	linked: boolean;
}) {
	const top = Math.max(...flow.steps.map((step) => step.perRun), 0);
	return (
		<div className="flex flex-col gap-5 bg-muted/50 px-3 pt-1 pb-4 pl-11">
			{flow.steps.length > 0 ? (
				<div className="flex flex-col">
					<div className="grid grid-cols-[minmax(0,1fr)_12rem_minmax(0,1fr)] gap-4 py-2 font-medium text-muted-foreground text-xs">
						<span>Step</span>
						<span>Cost per run</span>
						<span>What stands out</span>
					</div>
					{flow.steps.map((step) => (
						<div
							key={step.key}
							className="grid grid-cols-[minmax(0,1fr)_12rem_minmax(0,1fr)] items-center gap-4 border-t py-2 text-sm"
						>
							<span className="truncate font-mono text-xs">
								{nodeLadderLabel(step)}
							</span>
							<span className="flex items-center gap-2">
								<Progress
									value={top > 0 ? (step.perRun / top) * 100 : 0}
									aria-label={`Cost of ${nodeLadderLabel(step)} per run`}
									className="w-24 **:data-[slot=progress-indicator]:bg-chart-1 **:data-[slot=progress-track]:bg-background"
								/>
								<span className="text-xs tabular-nums">
									{formatCost(step.perRun)}
								</span>
							</span>
							<span className="text-muted-foreground text-xs">
								{stepNote(step) ?? "—"}
							</span>
						</div>
					))}
				</div>
			) : (
				<p className="pt-2 text-muted-foreground text-sm">
					{flow.usual
						? "The runs did not say what each step cost."
						: "No run finished with a known cost in these days."}
				</p>
			)}
			{savings.map((saving) => (
				<div
					key={saving.key}
					className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border bg-card p-3 text-sm"
				>
					<div className="flex min-w-0 flex-1 flex-col gap-0.5">
						<span className="font-medium">
							{savingTitle(saving)}
							<span className="font-normal text-muted-foreground tabular-nums">
								{" "}
								· saves {formatCost(saving.saves)}
							</span>
						</span>
						<span className="text-muted-foreground">
							{savingWhy(saving, formatCost)}
						</span>
					</div>
					<SavingActions saving={saving} linked={linked} />
				</div>
			))}
			{savings.length === 0 && linked ? (
				<div>
					<Button
						variant="outline"
						size="sm"
						nativeButton={false}
						render={
							<Link
								to="/projects/$projectId/flows/$name"
								params={{ projectId: flow.projectId, name: flow.flow }}
							/>
						}
					>
						Open the flow
					</Button>
				</div>
			) : null}
		</div>
	);
}

/** What stands out on a step: it worked more than once a run, or one run cost far more. */
function stepNote(step: SpendFlow["steps"][number]): string | null {
	const notes = [
		step.timesPerRun >= 1.5
			? `Works ${Math.round(step.timesPerRun * 10) / 10} times a run`
			: null,
		step.perRun > 0 && step.most > step.perRun * 2
			? `Up to ${formatCost(step.most)} in one run`
			: null,
	].filter((note) => note !== null);
	return notes.length > 0 ? notes.join(". ") : null;
}
