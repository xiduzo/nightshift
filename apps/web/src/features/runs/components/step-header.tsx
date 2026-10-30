import type { OutcomeColor } from "@nightshift/flows";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@nightshift/ui/components/collapsible";
import { ChevronRightIcon, HandIcon } from "lucide-react";
import type { ReactNode } from "react";
import { hasCost, NODE_TYPE, OutcomeBadge, stepState } from "@/features/flows";
import type { RunStatus, StepSummary } from "@/shared/api";
import { CodeView, formatJson, JsonBlock } from "@/shared/code";
import {
	formatDateTime,
	formatDuration,
	formatStepCost,
	formatTime,
	noCostYet,
} from "@/shared/format";
import { UsageContext } from "@/shared/usage";
import { jsonOutput } from "../lib/run-steps";
import { CostText } from "./cost-text";
import { useWorkTime } from "./elapsed";
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
	const { icon: typeIcon, label: typeLabel } = NODE_TYPE[step.nodeType];
	// A Decision step with a question was a Gate.
	const label = step.gate !== null ? "Gate" : typeLabel;
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
				{hasCost(step) ? ` · ${formatStepCost(step)}` : ""}
			</span>
		</div>
	);
}

/** The step's facts in a grid of small label-over-value cells: when, how long, how long it waited or slept, cost, visit, exit code, sessions. */
export function StepFacts({ step }: { step: StepSummary }) {
	const exit = step.outputs.exit_code;
	const time = useWorkTime([step], step.startedAt);
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
		{ label: "Took", value: time.active },
	];
	if (time.waited) facts.push({ label: "Waited for you", value: time.waited });
	if (time.slept) facts.push({ label: "Slept", value: time.slept });
	const metrics = step.metrics;
	if (metrics && metrics.agentMs >= 1000) {
		facts.push({
			label: "Agent worked",
			value: formatDuration(metrics.agentMs),
		});
	}
	const cost = hasCost(step) ? (
		noCostYet(step) ? (
			"—"
		) : (
			<CostText cost={step} />
		)
	) : undefined;
	if (metrics && metrics.tokens.input + metrics.tokens.output > 0) {
		const { input, output, cacheRead, cacheWrite } = metrics.tokens;
		facts.push({
			label: "Tokens",
			value: (
				<UsageContext
					size="xs"
					usage={{
						inputTokens: input,
						outputTokens: output,
						cacheReadTokens: cacheRead,
						cacheWriteTokens: cacheWrite,
					}}
					cost={cost}
				/>
			),
		});
	}
	if (cost !== undefined) facts.push({ label: "Cost", value: cost });
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
