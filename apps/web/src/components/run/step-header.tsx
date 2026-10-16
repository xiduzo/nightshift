import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "@nightshift/ui/components/empty";

import { hasCost, NODE_TYPE } from "@/components/flow/node-type";
import { OutcomeBadge, stepState } from "@/components/outcome-badge";
import type { RunStatus, StepSummary } from "@/lib/api-types";
import { formatCost, formatDateTime, formatTime } from "@/lib/format";
import { jsonOutput } from "@/lib/run-steps";

import { CodeView, JsonBlock } from "./json-block";
import { stepDuration } from "./step-timeline";

/** The selected step on one line: its node, outcome, when, how long, and what it cost. */
export function StepLine({
	step,
	runStatus,
}: {
	step: StepSummary;
	runStatus: RunStatus;
}) {
	const { icon: Icon, label } = NODE_TYPE[step.nodeType];
	return (
		<div className="flex min-w-0 items-center gap-2">
			<Icon
				className="size-4 shrink-0 text-muted-foreground"
				aria-hidden="true"
			/>
			<span className="sr-only">{label} step</span>
			<span className="truncate font-medium font-mono text-sm">
				{step.nodeId}
			</span>
			{step.visit > 1 ? (
				<span className="shrink-0 text-muted-foreground text-xs">
					visit {step.visit}
				</span>
			) : null}
			<OutcomeBadge state={stepState(step, runStatus)} className="shrink-0" />
			<span className="shrink-0 text-muted-foreground text-xs tabular-nums">
				<time
					dateTime={new Date(step.startedAt).toISOString()}
					title={formatDateTime(step.startedAt)}
				>
					{formatTime(step.startedAt)}
				</time>
				{" · "}
				{stepDuration(step)}
				{hasCost(step.nodeType) ? ` · ${formatCost(step.costUsd)}` : ""}
			</span>
		</div>
	);
}

/** The output that says in words what a step did, by node type. */
const PROSE_OUTPUT: Partial<Record<StepSummary["nodeType"], string>> = {
	agent: "summary",
	decision: "notes",
	gate: "note",
};

/** What the step did, in its own words: an Agent's summary, a Decision's notes, a Gate's note. */
export function stepProse(step: StepSummary): string | undefined {
	const field = PROSE_OUTPUT[step.nodeType];
	const value = field ? step.outputs[field] : undefined;
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** One line on what the step did, for a collapsed view: its error, else the first line of its prose or log. */
export function stepGist(step: StepSummary): string | undefined {
	if (step.error) return step.error.split("\n")[0];
	const prose = stepProse(step);
	if (prose) return prose.split("\n")[0];
	const logTail = step.outputs.log_tail;
	if (typeof logTail === "string" && logTail.trim()) {
		return logTail.trim().split("\n").at(-1);
	}
	return undefined;
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
