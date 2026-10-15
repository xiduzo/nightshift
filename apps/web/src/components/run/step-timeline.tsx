import { cn } from "@nightshift/ui/lib/utils";
import { ChevronRightIcon, ScanSearchIcon } from "lucide-react";
import { useState } from "react";

import { hasCost, NODE_TYPE } from "@/components/flow/node-type";
import {
	ItemStateBadge,
	OutcomeBadge,
	stepState,
} from "@/components/outcome-badge";
import type { ItemSummary, RunStatus, StepSummary } from "@/lib/api-types";
import {
	formatCost,
	formatDuration,
	formatTime,
	itemLabel,
} from "@/lib/format";
import { type ItemScope, itemsOf, scopeKey, stepsIn } from "@/lib/run-steps";

export function stepDuration(step: StepSummary, now = Date.now()): string {
	return formatDuration((step.endedAt ?? now) - step.startedAt);
}

/** Indent per level of For Each nesting. */
const INDENT_REM = 1;

/**
 * Every visit of every node, in the order they started. The steps of a For
 * Each body sit under their For Each step, grouped per item, indented and
 * collapsible. With `scope`, only the steps of that item show.
 */
export function StepTimeline({
	steps,
	scope,
	runStatus,
	selectedStepId,
	selectedItem,
	onSelect,
	onSelectItem,
}: {
	/** All steps of the run, in the order they started. */
	steps: StepSummary[];
	/** The item the list is narrowed to; null shows the whole run. */
	scope: ItemScope;
	runStatus: RunStatus;
	selectedStepId: string | null;
	selectedItem: ItemScope;
	onSelect: (stepId: string) => void;
	onSelectItem: (scope: ItemScope) => void;
}) {
	/** Groups the person opened or closed; the rest follow `defaultOpen`. */
	const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(
		() => new Map(),
	);

	if (steps.length === 0) {
		return (
			<p className="px-3 py-4 text-muted-foreground text-xs">
				No steps yet. The first one starts in a moment.
			</p>
		);
	}

	const numbers = new Map(steps.map((step, index) => [step.id, index + 1]));
	const roots = stepsIn(steps, scope);
	if (roots.length === 0) {
		return (
			<p className="px-3 py-4 text-muted-foreground text-xs">
				No steps for this item yet.
			</p>
		);
	}

	const renderSteps = (list: StepSummary[], depth: number) =>
		list.map((step) => (
			<li key={step.id}>
				<StepRow
					step={step}
					number={numbers.get(step.id) ?? 0}
					depth={depth}
					runStatus={runStatus}
					selected={step.id === selectedStepId}
					onSelect={() => onSelect(step.id)}
				/>
				{step.nodeType === "foreach" ? (
					<ol aria-label={`Items of ${step.nodeId}`}>
						{itemsOf(step, steps).map((item, index, items) => {
							const itemScope = { forEachStepId: step.id, itemId: item.id };
							const key = scopeKey(itemScope);
							const children = stepsIn(steps, itemScope);
							const open =
								toggled.get(key) ??
								(item.state === "running" || index === items.length - 1);
							return (
								<li key={key}>
									<ItemGroupRow
										item={item}
										depth={depth + 1}
										stepCount={children.length}
										open={open}
										selected={scopeKey(selectedItem) === key}
										onToggle={() =>
											setToggled((current) => new Map(current).set(key, !open))
										}
										onFocus={() => onSelectItem(itemScope)}
									/>
									{open && children.length > 0 ? (
										<ol className="divide-y border-t">
											{renderSteps(children, depth + 2)}
										</ol>
									) : null}
								</li>
							);
						})}
					</ol>
				) : null}
			</li>
		));

	return <ol className="flex flex-col divide-y">{renderSteps(roots, 0)}</ol>;
}

function StepRow({
	step,
	number,
	depth,
	runStatus,
	selected,
	onSelect,
}: {
	step: StepSummary;
	number: number;
	depth: number;
	runStatus: RunStatus;
	selected: boolean;
	onSelect: () => void;
}) {
	const Icon = NODE_TYPE[step.nodeType].icon;
	return (
		<button
			type="button"
			aria-current={selected ? "step" : undefined}
			onClick={onSelect}
			className={cn(
				"flex w-full items-center gap-2 py-1.5 pr-3 pl-3 text-left text-xs outline-none hover:bg-muted/50 focus-visible:bg-muted focus-visible:ring-1 focus-visible:ring-ring",
				selected && "bg-muted",
			)}
			style={
				depth > 0
					? { paddingLeft: `${0.75 + depth * INDENT_REM}rem` }
					: undefined
			}
		>
			<span className="w-5 shrink-0 text-right text-muted-foreground tabular-nums">
				{number}
			</span>
			<Icon
				className="size-3.5 shrink-0 text-muted-foreground"
				aria-label={NODE_TYPE[step.nodeType].label}
			/>
			<span className="min-w-0 truncate font-medium font-mono">
				{step.nodeId}
			</span>
			{step.visit > 1 ? (
				<span className="shrink-0 text-muted-foreground">
					visit {step.visit}
				</span>
			) : null}
			{step.nodeType === "foreach" && step.items.length > 0 ? (
				<span className="shrink-0 text-muted-foreground">
					{step.items.filter((item) => item.state === "done").length}/
					{step.items.length} done
				</span>
			) : null}
			<OutcomeBadge state={stepState(step, runStatus)} className="ml-auto" />
			<span
				className="w-14 shrink-0 text-right text-muted-foreground tabular-nums"
				title={`Started ${formatTime(step.startedAt)}`}
			>
				{stepDuration(step)}
			</span>
			<span className="w-14 shrink-0 text-right text-muted-foreground tabular-nums">
				{hasCost(step.nodeType) ? formatCost(step.costUsd) : "—"}
			</span>
		</button>
	);
}

/** One item of a For Each step: opens and closes its steps, or focuses on it. */
function ItemGroupRow({
	item,
	depth,
	stepCount,
	open,
	selected,
	onToggle,
	onFocus,
}: {
	item: ItemSummary;
	depth: number;
	stepCount: number;
	open: boolean;
	selected: boolean;
	onToggle: () => void;
	onFocus: () => void;
}) {
	return (
		<div
			className={cn(
				"group/item flex items-center border-t bg-muted/20 text-xs",
				selected && "bg-muted",
			)}
			style={{ paddingLeft: `${depth * INDENT_REM}rem` }}
		>
			<button
				type="button"
				aria-expanded={open}
				onClick={onToggle}
				disabled={stepCount === 0}
				className="flex min-w-0 flex-1 items-center gap-2 py-1 pr-2 pl-3 text-left outline-none hover:bg-muted/50 focus-visible:bg-muted focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-default disabled:hover:bg-transparent"
				title={
					stepCount === 0
						? "No steps yet"
						: open
							? "Hide its steps"
							: "Show its steps"
				}
			>
				<ChevronRightIcon
					aria-hidden="true"
					className={cn(
						"size-3.5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none",
						open && "rotate-90",
						stepCount === 0 && "opacity-30",
					)}
				/>
				<span className="shrink-0 font-mono text-muted-foreground">
					{itemLabel(item.id, item.number)}
				</span>
				<span className="min-w-0 truncate">{item.title}</span>
				<span className="shrink-0 text-muted-foreground">
					{stepCount} {stepCount === 1 ? "step" : "steps"}
				</span>
				<ItemStateBadge state={item.state} className="ml-auto" />
			</button>
			<button
				type="button"
				onClick={onFocus}
				aria-pressed={selected}
				aria-label={`Focus on ${itemLabel(item.id, item.number)}: its steps and its body flow`}
				title="Focus on this item: its steps and its body flow"
				className="mr-1 flex size-6 shrink-0 items-center justify-center text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
			>
				<ScanSearchIcon className="size-3.5" aria-hidden="true" />
			</button>
		</div>
	);
}
