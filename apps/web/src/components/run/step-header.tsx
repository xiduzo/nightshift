import type { OutcomeColor } from "@nightshift/flows";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@nightshift/ui/components/collapsible";
import { ChevronRightIcon, HandIcon } from "lucide-react";
import type { ReactNode } from "react";
import { CostText } from "@/components/cost-text";
import { hasCost, NODE_TYPE } from "@/components/flow/node-type";
import { OutcomeBadge, stepState } from "@/components/outcome-badge";
import type { RunStatus, StepSummary } from "@/lib/api-types";
import { formatDateTime, formatKnownCost, formatTime } from "@/lib/format";
import { formatJson, jsonOutput } from "@/lib/run-steps";

import { CodeView, JsonBlock } from "./json-block";
import { StepDuration } from "./step-timeline";

/** The selected step on one line: its node, outcome, when, how long, and what it cost. */
export function StepLine({
	step,
	runStatus,
	outcomeColor,
}: {
	step: StepSummary;
	runStatus: RunStatus;
	/** The colour the step's node gives its outcome. */
	outcomeColor?: OutcomeColor;
}) {
	const { icon: typeIcon, label } = NODE_TYPE[step.nodeType];
	const Icon = step.gate !== null ? HandIcon : typeIcon;
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
			<OutcomeBadge
				state={stepState(step, runStatus)}
				color={outcomeColor}
				className="shrink-0"
			/>
			<span className="shrink-0 text-muted-foreground text-xs tabular-nums">
				<time
					dateTime={new Date(step.startedAt).toISOString()}
					title={formatDateTime(step.startedAt)}
				>
					{formatTime(step.startedAt)}
				</time>
				{" · "}
				<StepDuration step={step} />
				{hasCost(step) ? ` · ${formatKnownCost(step)}` : ""}
			</span>
		</div>
	);
}

/** The output that says in words what a step did, by node type. */
const PROSE_OUTPUT: Partial<Record<StepSummary["nodeType"], string>> = {
	agent: "summary",
	decision: "note",
};

/** What the step did, in its own words: an Agent's summary, or a Decision's note. */
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

/** The step's facts in a grid of small label-over-value cells: when, how long, cost, visit, exit code, sessions. */
export function StepFacts({ step }: { step: StepSummary }) {
	const exit = step.outputs.exit_code;
	const facts: { label: string; value: ReactNode }[] = [
		{
			label: "Started",
			value: (
				<time
					dateTime={new Date(step.startedAt).toISOString()}
					title={formatDateTime(step.startedAt)}
				>
					{formatTime(step.startedAt)}
				</time>
			),
		},
		{ label: "Took", value: <StepDuration step={step} /> },
	];
	if (hasCost(step)) {
		facts.push({ label: "Cost", value: <CostText cost={step} /> });
	}
	if (step.visit > 1) facts.push({ label: "Visit", value: step.visit });
	if (exit !== undefined && exit !== "") {
		facts.push({ label: "Exit code", value: String(exit) });
	}
	if (step.sessions.length > 0) {
		facts.push({ label: "Sessions", value: step.sessions.length });
	}
	if (step.device) {
		facts.push({
			label: "Ran on",
			value: step.device.thisDevice
				? "This computer"
				: (step.device.name ?? "Another device"),
		});
	}
	return (
		<dl className="grid grid-cols-[repeat(auto-fill,minmax(6rem,1fr))] gap-x-4 gap-y-3">
			{facts.map((fact) => (
				<div key={fact.label} className="flex min-w-0 flex-col gap-0.5">
					<dt className="text-muted-foreground text-xs">{fact.label}</dt>
					<dd className="truncate text-sm tabular-nums">{fact.value}</dd>
				</div>
			))}
		</dl>
	);
}

/**
 * The outputs later nodes can read from the step, one row each: the field
 * and its value on one line. A row opens on the whole value.
 */
export function StepOutputs({ step }: { step: StepSummary }) {
	const outputs = Object.entries(step.outputs);
	if (outputs.length === 0) {
		return (
			<p className="text-muted-foreground text-xs">
				{step.outcome === null
					? "The step has not ended yet."
					: "This step left nothing for later nodes to read."}
			</p>
		);
	}
	return (
		<ul className="flex flex-col divide-y rounded-lg border">
			{outputs.map(([field, value]) => {
				const json = jsonOutput(value);
				const text = json !== undefined ? formatJson(json) : String(value);
				return (
					<li key={field}>
						<Collapsible>
							<CollapsibleTrigger
								className="group/output flex w-full min-w-0 items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
								title={`{{${step.nodeId}.${field}}}`}
							>
								<ChevronRightIcon
									aria-hidden="true"
									className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-panel-open/output:rotate-90 motion-reduce:transition-none"
								/>
								<span className="shrink-0 font-mono text-muted-foreground">
									{field}
								</span>
								<span className="min-w-0 flex-1 truncate font-mono group-data-panel-open/output:invisible">
									{text.replace(/\s+/g, " ") || (
										<span className="text-muted-foreground italic">empty</span>
									)}
								</span>
							</CollapsibleTrigger>
							<CollapsibleContent className="px-2.5 pb-2.5">
								{json !== undefined ? (
									<JsonBlock value={json} />
								) : text ? (
									<CodeView code={text} language="text" />
								) : (
									<span className="text-muted-foreground text-xs italic">
										empty
									</span>
								)}
							</CollapsibleContent>
						</Collapsible>
					</li>
				);
			})}
		</ul>
	);
}
