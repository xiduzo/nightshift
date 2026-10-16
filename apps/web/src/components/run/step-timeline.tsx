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
} from "@nightshift/ui/components/empty";
import { Item } from "@nightshift/ui/components/item";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import { cn } from "@nightshift/ui/lib/utils";
import { ChevronRightIcon, ScanSearchIcon, WorkflowIcon } from "lucide-react";
import { type ReactNode, useState } from "react";

import { hasCost, NODE_TYPE } from "@/components/flow/node-type";
import {
	ItemStateBadge,
	OutcomeBadge,
	stepState,
} from "@/components/outcome-badge";
import type { RunStatus, StepSummary } from "@/lib/api-types";
import { formatCost, formatDuration, formatTime } from "@/lib/format";
import { type ItemScope, itemsOf, scopeKey, stepsIn } from "@/lib/run-steps";

export function stepDuration(step: StepSummary, now = Date.now()): string {
	return formatDuration((step.endedAt ?? now) - step.startedAt);
}

/** Indent per level of nesting. */
const INDENT_REM = 1.25;

/**
 * Every visit of every node, in the order they started. The steps of a
 * called flow sit under the Subflow step that called it, or under their For
 * Each step grouped per element, indented and collapsible. With `scope`,
 * only the steps of that call show.
 */
export function StepTimeline({
	steps,
	scope,
	runStatus,
	selectedStepId,
	selectedItem,
	onSelect,
	onSelectItem,
	calledName,
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
	/** The name of the flow a Subflow or For Each step calls. */
	calledName?: (step: StepSummary) => string | undefined;
}) {
	/** Groups the person opened or closed; the rest follow `defaultOpen`. */
	const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(
		() => new Map(),
	);

	if (steps.length === 0) {
		return (
			<Empty className="py-8">
				<EmptyHeader>
					<EmptyDescription className="text-xs">
						No steps yet. The first one starts in a moment.
					</EmptyDescription>
				</EmptyHeader>
			</Empty>
		);
	}

	const numbers = new Map(steps.map((step, index) => [step.id, index + 1]));
	const roots = stepsIn(steps, scope);
	if (roots.length === 0) {
		return (
			<Empty className="py-8">
				<EmptyHeader>
					<EmptyDescription className="text-xs">
						No steps for this item yet.
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
					number={numbers.get(step.id) ?? 0}
					depth={depth}
					runStatus={runStatus}
					selected={step.id === selectedStepId}
					onSelect={() => onSelect(step.id)}
				/>
				{step.nodeType === "subflow" ? (
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
				{step.nodeType === "foreach" ? (
					<ol
						aria-label={`Elements of ${step.nodeId}`}
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
		<Item
			size="xs"
			render={<button type="button" />}
			aria-current={selected ? "step" : undefined}
			onClick={onSelect}
			className={cn(
				"flex-nowrap gap-2 py-1.5 text-left text-xs hover:bg-muted/60",
				selected && "bg-muted hover:bg-muted",
			)}
			style={
				depth > 0
					? { paddingLeft: `${0.625 + depth * INDENT_REM}rem` }
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
				<span className="hidden shrink-0 text-muted-foreground tabular-nums sm:inline">
					{step.items.filter((item) => item.state === "done").length}/
					{step.items.length} done
				</span>
			) : null}
			<OutcomeBadge state={stepState(step, runStatus)} className="ml-auto" />
			<span
				className="w-12 shrink-0 text-right text-muted-foreground tabular-nums"
				title={`Started ${formatTime(step.startedAt)}`}
			>
				{stepDuration(step)}
			</span>
			<span className="hidden w-12 shrink-0 text-right text-muted-foreground tabular-nums sm:inline">
				{hasCost(step.nodeType) ? formatCost(step.costUsd) : "—"}
			</span>
		</Item>
	);
}

/** One call of a flow (a Subflow step, or one element of a For Each step): opens and closes its steps, or focuses on it. */
function GroupRow({
	label,
	badge,
	depth,
	stepCount,
	open,
	selected,
	onFocus,
}: {
	label: ReactNode;
	badge: ReactNode;
	depth: number;
	stepCount: number;
	open: boolean;
	selected: boolean;
	onFocus: () => void;
}) {
	return (
		<div
			className={cn(
				"flex items-center gap-1 rounded-md pr-1 text-xs",
				selected ? "bg-muted" : "hover:bg-muted/40",
			)}
			style={{ paddingLeft: `${depth * INDENT_REM}rem` }}
		>
			<CollapsibleTrigger
				disabled={stepCount === 0}
				className="group/row flex min-w-0 flex-1 items-center gap-2 rounded-md py-1.5 pr-1 pl-2.5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default"
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
						open && stepCount > 0 && "rotate-90",
						stepCount === 0 && "opacity-30",
					)}
				/>
				{label}
				<span className="hidden shrink-0 text-muted-foreground tabular-nums sm:inline">
					{stepCount} {stepCount === 1 ? "step" : "steps"}
				</span>
				{badge ? <span className="ml-auto shrink-0">{badge}</span> : null}
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
