import { hasCost, NODE_TYPE } from "@/components/flow/node-type";
import { OutcomeBadge, stepState } from "@/components/outcome-badge";
import type { StepSummary } from "@/lib/api-types";
import { formatCost, formatDateTime, formatTime } from "@/lib/format";

import { stepDuration } from "./step-timeline";

/** What the selected step is, and the outputs later nodes can read from it. */
export function StepHeader({ step }: { step: StepSummary }) {
	const Icon = NODE_TYPE[step.nodeType].icon;
	const outputs = Object.entries(step.outputs);

	return (
		<div className="flex flex-col gap-1.5 border-b px-4 py-2">
			<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
				<h2 className="flex items-center gap-1.5 font-medium text-sm">
					<Icon className="size-4 text-muted-foreground" aria-hidden="true" />
					<span className="font-mono">{step.nodeId}</span>
					{step.visit > 1 ? (
						<span className="font-normal text-muted-foreground text-xs">
							visit {step.visit}
						</span>
					) : null}
				</h2>
				<OutcomeBadge state={stepState(step)} />
				<span className="text-muted-foreground">
					<time
						dateTime={new Date(step.startedAt).toISOString()}
						title={formatDateTime(step.startedAt)}
					>
						{formatTime(step.startedAt)}
					</time>{" "}
					· {stepDuration(step)}
					{hasCost(step.nodeType) ? ` · ${formatCost(step.costUsd)}` : ""}
				</span>
			</div>
			{outputs.length > 0 ? (
				<details className="group/outputs text-xs">
					<summary className="cursor-pointer select-none text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring">
						Outputs ({outputs.length})
					</summary>
					<dl className="mt-1.5 grid max-h-48 grid-cols-[auto_1fr] gap-x-3 gap-y-1 overflow-y-auto">
						{outputs.map(([field, value]) => (
							<div key={field} className="contents">
								<dt className="font-mono text-muted-foreground">
									{`{{${step.nodeId}.${field}}}`}
								</dt>
								<dd className="line-clamp-3 whitespace-pre-wrap break-words font-mono">
									{String(value) || (
										<span className="text-muted-foreground italic">empty</span>
									)}
								</dd>
							</div>
						))}
					</dl>
				</details>
			) : null}
		</div>
	);
}
