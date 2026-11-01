import { tokensLabel, usageLabel } from "@nightshift/client";
import type { OutcomeColor } from "@nightshift/flows";
import { Button } from "@nightshift/ui/components/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@nightshift/ui/components/collapsible";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@nightshift/ui/components/empty";
import { Item } from "@nightshift/ui/components/item";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import { cn } from "@nightshift/ui/lib/utils";
import {
	ChevronRightIcon,
	ListTodoIcon,
	ScanSearchIcon,
	TriangleAlertIcon,
	WorkflowIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
	hasCost,
	ItemStateBadge,
	NODE_TYPE,
	OutcomeBadge,
	stepState,
} from "@/features/flows";
import type { RunStatus, StepSummary } from "@/shared/api";
import {
	formatKnownCost,
	formatStepUsage,
	hoverTime,
	noCostYet,
	sumKnownCost,
} from "@/shared/format";
import {
	callsFlow,
	type ItemScope,
	itemsOf,
	scopeKey,
	stepsIn,
	stepsUnder,
} from "../lib/run-steps";

import { WorkTime } from "./elapsed";

/** How long the step took, counting up while it runs and standing still while its Gate waits. */
export function StepDuration({ step }: { step: StepSummary }) {
	return <WorkTime steps={[step]} start={step.startedAt} />;
}

/** From the first step's start to the last one's end, without the time a Gate waited for you or a step slept. */
function spanOf(list: StepSummary[]): ReactNode {
	if (list.length === 0) return undefined;
	const start = Math.min(...list.map((step) => step.startedAt));
	return <WorkTime steps={list} start={start} />;
}

/** The tokens of these steps, when any were used. */
function tokensOf(list: readonly StepSummary[]) {
	let input = 0;
	let output = 0;
	for (const step of list) {
		const tokens = step.metrics?.tokens;
		if (!tokens) continue;
		input += tokens.input;
		output += tokens.output;
	}
	return input + output > 0 ? { input, output } : null;
}

/** What these steps used and cost. Undefined when none of them can cost and none used tokens. */
function usageOf(list: StepSummary[]): string | undefined {
	const costing = list.filter(hasCost);
	const tokens = tokensOf(list);
	if (costing.length === 0) return tokensLabel(tokens) ?? undefined;
	if (costing.every(noCostYet)) return usageLabel(tokens, null) ?? "—";
	return usageLabel(tokens, formatKnownCost(sumKnownCost(costing))) ?? "—";
}

/** Every step a Call step called, nested ones included. */
function calledSteps(steps: StepSummary[], step: StepSummary): StepSummary[] {
	const ids = new Set([step.id]);
	// Steps start after their caller, so one pass in order finds every level.
	return steps.filter((other) => {
		if (!other.scope || !ids.has(other.scope.parentStepId)) return false;
		ids.add(other.id);
		return true;
	});
}

/** Indent per level of nesting. */
const INDENT_REM = 0.75;

/**
 * Every visit of every node, in the order they started. The steps of a
 * called flow sit under the Call step that called it, grouped per element
 * for a Call with `each`, indented and collapsible. With `scope`,
 * only the steps of that call show.
 */
export function StepTimeline({
	steps,
	scope,
	runStatus,
	selectedStepId,
	selectedItem,
	onSelect,
	revealStepId = null,
	onSelectItem,
	calledName,
	runsEach,
	warnedStepIds,
	stepAction,
	outcomeColor,
}: {
	/** All steps of the run, in the order they started. */
	steps: StepSummary[];
	/** The item the list is narrowed to; null shows the whole run. */
	scope: ItemScope;
	runStatus: RunStatus;
	selectedStepId: string | null;
	selectedItem: ItemScope;
	/** A step a link opened the run at: its row scrolls into view while it is selected. */
	revealStepId?: string | null;
	onSelect: (stepId: string) => void;
	onSelectItem: (scope: ItemScope) => void;
	/** The name of the flow a Call step calls. */
	calledName?: (step: StepSummary) => string | undefined;
	/** Whether a Call step runs its flow once per item. Without it, a step that started items does. */
	runsEach?: (step: StepSummary) => boolean;
	/** The steps the run warned about: their rows show a warning sign. */
	warnedStepIds?: ReadonlySet<string>;
	/** A button for a step's actions, at the end of its row. */
	stepAction?: (step: StepSummary) => ReactNode;
	/** The colour a step's node gives its outcome. */
	outcomeColor?: (step: StepSummary) => OutcomeColor | undefined;
}) {
	/** Groups the person opened or closed; the rest follow `defaultOpen`. */
	const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(
		() => new Map(),
	);
	const eachOf = (step: StepSummary) =>
		runsEach?.(step) ?? step.items.length > 0;

	if (steps.length === 0) {
		return (
			<Empty>
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<ListTodoIcon aria-hidden="true" />
					</EmptyMedia>
					<EmptyTitle>No steps yet</EmptyTitle>
					<EmptyDescription>The first one starts in a moment.</EmptyDescription>
				</EmptyHeader>
			</Empty>
		);
	}

	const numbers = new Map(steps.map((step, index) => [step.id, index + 1]));
	const roots = stepsIn(steps, scope);
	if (roots.length === 0) {
		return (
			<Empty>
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<ListTodoIcon aria-hidden="true" />
					</EmptyMedia>
					<EmptyTitle>No steps yet</EmptyTitle>
					<EmptyDescription>
						The steps for this item show here once they start.
					</EmptyDescription>
				</EmptyHeader>
			</Empty>
		);
	}

	const renderGroup = ({
		scope: groupScope,
		depth,
		defaultOpen,
		label,
		badge,
	}: {
		scope: NonNullable<ItemScope>;
		depth: number;
		defaultOpen: boolean;
		label: ReactNode;
		badge: ReactNode;
	}) => {
		const key = scopeKey(groupScope);
		const children = stepsIn(steps, groupScope);
		const nested = stepsUnder(steps, groupScope);
		const open = toggled.get(key) ?? defaultOpen;
		return (
			<li key={key}>
				<Collapsible
					open={open && children.length > 0}
					onOpenChange={(next) =>
						setToggled((current) => new Map(current).set(key, next))
					}
				>
					<GroupRow
						label={label}
						badge={badge}
						duration={spanOf(nested)}
						cost={usageOf(nested)}
						depth={depth}
						stepCount={children.length}
						open={open}
						selected={scopeKey(selectedItem) === key}
						onFocus={() => onSelectItem(groupScope)}
					/>
					<CollapsibleContent>
						<ol className="flex flex-col gap-0.5 pt-0.5">
							{renderSteps(children, depth + 1)}
						</ol>
					</CollapsibleContent>
				</Collapsible>
			</li>
		);
	};

	const renderSteps = (list: StepSummary[], depth: number): ReactNode =>
		list.map((step) => (
			<li key={step.id} className="flex flex-col gap-0.5">
				<StepRow
					step={step}
					cost={
						callsFlow(step)
							? usageOf(calledSteps(steps, step))
							: hasCost(step)
								? formatStepUsage(step)
								: undefined
					}
					number={numbers.get(step.id) ?? 0}
					depth={depth}
					runStatus={runStatus}
					selected={step.id === selectedStepId}
					reveal={step.id === selectedStepId && step.id === revealStepId}
					warned={warnedStepIds?.has(step.id) ?? false}
					onSelect={() => onSelect(step.id)}
					outcomeColor={outcomeColor?.(step)}
					action={stepAction?.(step)}
				/>
				{step.nodeType === "call" && !eachOf(step) ? (
					<ol
						aria-label={`Steps called by ${step.nodeId}`}
						className="flex flex-col gap-0.5"
					>
						{renderGroup({
							scope: { parentStepId: step.id, itemId: null },
							depth: depth + 1,
							defaultOpen: true,
							label: (
								<>
									<WorkflowIcon
										className="size-3.5 shrink-0 text-muted-foreground"
										aria-hidden="true"
									/>
									<span className="min-w-0 truncate font-mono">
										{calledName?.(step) ?? "called flow"}
									</span>
								</>
							),
							badge: null,
						})}
					</ol>
				) : null}
				{step.nodeType === "call" && eachOf(step) ? (
					<ol
						aria-label={`Items of ${step.nodeId}`}
						className="flex flex-col gap-0.5"
					>
						{itemsOf(step, steps).map((item, index, items) =>
							renderGroup({
								scope: { parentStepId: step.id, itemId: item.id },
								depth: depth + 1,
								defaultOpen:
									item.state === "running" || index === items.length - 1,
								label: (
									<>
										{item.title !== item.id ? (
											<span className="max-w-[35%] shrink-0 truncate font-mono text-muted-foreground">
												{item.id}
											</span>
										) : null}
										<span className="min-w-0 truncate">{item.title}</span>
									</>
								),
								badge: <ItemStateBadge state={item.state} />,
							}),
						)}
					</ol>
				) : null}
			</li>
		));

	return (
		<ol className="flex flex-col gap-0.5 p-1.5">{renderSteps(roots, 0)}</ol>
	);
}

/**
 * The columns every row ends in, so they line up down the list: its state,
 * how long it took, what it cost, and a slot for the focus button.
 */
function RowStats({
	badge,
	duration,
	durationTitle,
	cost,
}: {
	badge: ReactNode;
	duration: ReactNode;
	durationTitle?: string;
	cost: string | undefined;
}) {
	return (
		<>
			<span className="ml-auto flex w-28 shrink-0 justify-start">{badge}</span>
			<span
				className="w-14 shrink-0 whitespace-nowrap text-right text-muted-foreground tabular-nums"
				title={durationTitle}
			>
				{duration}
			</span>
			<span className="hidden w-44 shrink-0 whitespace-nowrap text-right text-muted-foreground tabular-nums sm:inline">
				{cost}
			</span>
		</>
	);
}

/** The height of every row in the list. */
const ROW = "h-8";

function StepRow({
	step,
	cost,
	number,
	depth,
	runStatus,
	selected,
	reveal,
	warned,
	onSelect,
	action,
	outcomeColor,
}: {
	step: StepSummary;
	/** Its own cost, or what the steps it called cost together. */
	cost: string | undefined;
	number: number;
	depth: number;
	runStatus: RunStatus;
	selected: boolean;
	/** A link opened the run at this step: the row scrolls into view. */
	reveal: boolean;
	/** The run warned about this step. */
	warned: boolean;
	onSelect: () => void;
	/** A button for the step's actions, at the end of the row. */
	action?: ReactNode;
	/** The colour the step's node gives its outcome. */
	outcomeColor?: OutcomeColor;
}) {
	const Icon = NODE_TYPE[step.nodeType].icon;
	const row = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (reveal) row.current?.scrollIntoView({ block: "nearest" });
	}, [reveal]);
	return (
		<div
			ref={row}
			className={cn(
				ROW,
				"flex items-center gap-1 rounded-md pr-1",
				selected ? "bg-muted" : "hover:bg-muted/60",
			)}
		>
			<Item
				size="xs"
				render={<button type="button" />}
				aria-current={selected ? "step" : undefined}
				onClick={onSelect}
				className="h-full min-w-0 flex-1 flex-nowrap gap-2 py-0 pr-1 pl-1 text-left text-xs"
				style={
					depth > 0
						? { paddingLeft: `${0.25 + depth * INDENT_REM}rem` }
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
				{warned ? (
					<TriangleAlertIcon
						className="size-3.5 shrink-0 text-status-waiting"
						aria-label="This step has a warning"
					/>
				) : null}
				{step.visit > 1 ? (
					<span className="shrink-0 text-muted-foreground">
						visit {step.visit}
					</span>
				) : null}
				{typeof step.outputs.tier === "string" ? (
					<span className="hidden shrink-0 text-muted-foreground sm:inline">
						tier {step.outputs.tier}
					</span>
				) : null}
				{step.nodeType === "call" && step.items.length > 0 ? (
					<span className="hidden shrink-0 text-muted-foreground tabular-nums sm:inline">
						{step.items.filter((item) => item.state === "done").length}/
						{step.items.length} done
					</span>
				) : null}
				<RowStats
					badge={
						<OutcomeBadge
							state={stepState(step, runStatus)}
							color={outcomeColor}
						/>
					}
					duration={<StepDuration step={step} />}
					durationTitle={`Started ${hoverTime(step.startedAt)}`}
					cost={cost}
				/>
			</Item>
			{/* The step's actions, in the slot of the focus button on a call's row. */}
			{action ?? <span className="size-6 shrink-0" aria-hidden="true" />}
		</div>
	);
}

/** One call of a flow (a Call step, or one of its elements): opens and closes its steps, or focuses on it. */
function GroupRow({
	label,
	badge,
	duration,
	cost,
	depth,
	stepCount,
	open,
	selected,
	onFocus,
}: {
	label: ReactNode;
	badge: ReactNode;
	duration: ReactNode;
	cost: string | undefined;
	depth: number;
	stepCount: number;
	open: boolean;
	selected: boolean;
	onFocus: () => void;
}) {
	return (
		<div
			className={cn(
				ROW,
				"flex items-center gap-1 rounded-md pr-1 text-xs",
				selected ? "bg-muted" : "hover:bg-muted/40",
			)}
			style={{ paddingLeft: `${depth * INDENT_REM}rem` }}
		>
			<CollapsibleTrigger
				disabled={stepCount === 0}
				className="group/row flex h-full min-w-0 flex-1 items-center gap-2 rounded-md pr-1 pl-1 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default"
				title={
					stepCount === 0
						? "No steps yet"
						: open
							? "Hide its steps"
							: "Show its steps"
				}
			>
				<span className="flex w-5 shrink-0 justify-end">
					<ChevronRightIcon
						aria-hidden="true"
						className={cn(
							"size-3.5 text-muted-foreground transition-transform motion-reduce:transition-none",
							open && stepCount > 0 && "rotate-90",
							stepCount === 0 && "opacity-30",
						)}
					/>
				</span>
				{label}
				<span className="hidden shrink-0 text-muted-foreground tabular-nums sm:inline">
					{stepCount} {stepCount === 1 ? "step" : "steps"}
				</span>
				<RowStats badge={badge} duration={duration} cost={cost} />
			</CollapsibleTrigger>
			<Tooltip>
				<TooltipTrigger
					render={
						<Button
							variant="ghost"
							size="icon-xs"
							onClick={onFocus}
							aria-pressed={selected}
							aria-label="Focus on this call: its steps and the flow it ran"
							className="text-muted-foreground"
						/>
					}
				>
					<ScanSearchIcon aria-hidden="true" />
				</TooltipTrigger>
				<TooltipContent>
					Focus on this call: its steps and the flow it ran
				</TooltipContent>
			</Tooltip>
		</div>
	);
}
