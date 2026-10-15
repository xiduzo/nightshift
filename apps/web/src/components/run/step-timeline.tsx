import { cn } from "@nightshift/ui/lib/utils";
import { hasCost, NODE_TYPE } from "@/components/flow/node-type";
import { OutcomeBadge, stepState } from "@/components/outcome-badge";
import type { StepSummary } from "@/lib/api-types";
import { formatCost, formatDuration, formatTime } from "@/lib/format";

export function stepDuration(step: StepSummary, now = Date.now()): string {
	return formatDuration((step.endedAt ?? now) - step.startedAt);
}

/** Every visit of every node, in the order they started. */
export function StepTimeline({
	steps,
	selectedStepId,
	onSelect,
}: {
	steps: StepSummary[];
	selectedStepId: string | null;
	onSelect: (stepId: string) => void;
}) {
	if (steps.length === 0) {
		return (
			<p className="px-3 py-4 text-muted-foreground text-xs">
				No steps yet. The first one starts in a moment.
			</p>
		);
	}

	return (
		<ol className="flex flex-col divide-y">
			{steps.map((step, index) => {
				const selected = step.id === selectedStepId;
				const Icon = NODE_TYPE[step.nodeType].icon;
				return (
					<li key={step.id}>
						<button
							type="button"
							aria-current={selected ? "step" : undefined}
							onClick={() => onSelect(step.id)}
							className={cn(
								"flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs outline-none hover:bg-muted/50 focus-visible:bg-muted focus-visible:ring-1 focus-visible:ring-ring",
								selected && "bg-muted",
							)}
						>
							<span className="w-5 shrink-0 text-right text-muted-foreground tabular-nums">
								{index + 1}
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
							<OutcomeBadge state={stepState(step)} className="ml-auto" />
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
					</li>
				);
			})}
		</ol>
	);
}
