import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "@nightshift/ui/components/empty";
import type { ReactNode } from "react";

import { hasCost, NODE_TYPE } from "@/components/flow/node-type";
import { OutcomeBadge, stepState } from "@/components/outcome-badge";
import type { RunStatus, StepSummary } from "@/lib/api-types";
import { formatCost, formatDateTime, formatTime } from "@/lib/format";
import { jsonOutput } from "@/lib/run-steps";

import { CodeView, JsonBlock } from "./json-block";
import { stepDuration } from "./step-timeline";

/** What the selected step is: its node, outcome, when, how long, and what it cost. */
export function StepHeader({
	step,
	runStatus,
	context,
	actions,
}: {
	step: StepSummary;
	runStatus: RunStatus;
	/** Where the step ran, for a step inside a called flow. */
	context?: ReactNode;
	/** On the right, such as "follow the latest step". */
	actions?: ReactNode;
}) {
	const { icon: Icon, label } = NODE_TYPE[step.nodeType];

	return (
		<div className="flex flex-col gap-1.5 border-b px-4 py-3">
			<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
				<h2 className="flex min-w-0 items-center gap-2 font-medium text-sm">
					<span
						className="flex size-7 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground"
						title={label}
					>
						<Icon className="size-4" aria-hidden="true" />
					</span>
					<span className="truncate font-mono">{step.nodeId}</span>
					{step.visit > 1 ? (
						<span className="shrink-0 font-normal text-muted-foreground text-xs">
							visit {step.visit}
						</span>
					) : null}
				</h2>
				<OutcomeBadge state={stepState(step, runStatus)} />
				<p className="text-muted-foreground text-xs tabular-nums">
					<span className="sr-only">{label} step · </span>
					<time
						dateTime={new Date(step.startedAt).toISOString()}
						title={formatDateTime(step.startedAt)}
					>
						{formatTime(step.startedAt)}
					</time>
					{" · "}
					{stepDuration(step)}
					{hasCost(step.nodeType) ? ` · ${formatCost(step.costUsd)}` : ""}
				</p>
				{actions ? (
					<div className="ml-auto flex items-center gap-1">{actions}</div>
				) : null}
			</div>
			{context ? (
				<div className="min-w-0 text-muted-foreground text-xs">{context}</div>
			) : null}
		</div>
	);
}

/** The outputs later nodes can read from the step, as `{{node.field}}`. */
export function StepOutputs({ step }: { step: StepSummary }) {
	const outputs = Object.entries(step.outputs);
	if (outputs.length === 0) {
		return (
			<Empty className="py-10">
				<EmptyHeader>
					<EmptyTitle className="text-sm">No outputs</EmptyTitle>
					<EmptyDescription className="text-xs">
						{step.outcome === null
							? "The step has not ended yet."
							: "This step left nothing for later nodes to read."}
					</EmptyDescription>
				</EmptyHeader>
			</Empty>
		);
	}
	return (
		<dl className="flex flex-col gap-4 p-4 text-xs">
			{outputs.map(([field, value]) => {
				const json = jsonOutput(value);
				return (
					<div key={field} className="flex min-w-0 flex-col gap-1.5">
						<dt className="font-medium font-mono text-muted-foreground">
							{`{{${step.nodeId}.${field}}}`}
						</dt>
						{json !== undefined ? (
							<dd className="min-w-0">
								<JsonBlock value={json} />
							</dd>
						) : (
							<dd className="min-w-0">
								{String(value) ? (
									<CodeView code={String(value)} language="text" />
								) : (
									<span className="text-muted-foreground italic">empty</span>
								)}
							</dd>
						)}
					</div>
				);
			})}
		</dl>
	);
}
