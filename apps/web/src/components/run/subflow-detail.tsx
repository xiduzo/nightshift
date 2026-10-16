import { Button } from "@nightshift/ui/components/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@nightshift/ui/components/card";
import { ScanSearchIcon, WorkflowIcon } from "lucide-react";

import type { RunDetail, StepSummary } from "@/lib/api-types";
import {
	calledFlowOf,
	type ItemScope,
	jsonOutput,
	nodeOfStep,
	stepsIn,
} from "@/lib/run-steps";

import { CodeView, JsonBlock } from "./json-block";

/** Fields every Subflow step has; the rest are the called flow's outputs. */
const OWN_FIELDS = new Set(["outcome", "ended", "visit"]);

/**
 * A Subflow step: the flow it called, the inputs it bound (templates from
 * the run's copy of the flow), and the outputs the flow returned.
 */
export function SubflowDetail({
	run,
	steps,
	step,
	focused,
	onFocus,
}: {
	run: RunDetail;
	steps: StepSummary[];
	step: StepSummary;
	focused: boolean;
	onFocus: (scope: ItemScope) => void;
}) {
	const node = nodeOfStep(run, steps, step);
	const called = calledFlowOf(run, steps, step);
	const bindings = node?.type === "subflow" ? Object.entries(node.inputs) : [];
	const declared = called?.inputs ?? [];
	const returned = Object.entries(step.outputs).filter(
		([field]) => !OWN_FIELDS.has(field),
	);
	const ended = step.outputs.ended;
	const childCount = stepsIn(steps, {
		parentStepId: step.id,
		itemId: null,
	}).length;

	return (
		<section aria-label="The called flow" className="flex flex-col gap-4 p-4">
			<header className="flex flex-wrap items-center gap-x-3 gap-y-2">
				<h3 className="flex min-w-0 items-center gap-2 font-medium text-sm">
					<WorkflowIcon
						className="size-4 shrink-0 text-muted-foreground"
						aria-hidden="true"
					/>
					Called{" "}
					<span className="truncate font-mono">
						{node?.type === "subflow" ? node.flow : "a flow"}
					</span>
				</h3>
				<span className="text-muted-foreground text-xs tabular-nums">
					{childCount} {childCount === 1 ? "step" : "steps"}
					{typeof ended === "string" && ended !== ""
						? ` · ended on ${ended}`
						: ""}
				</span>
				<Button
					variant={focused ? "secondary" : "outline"}
					size="sm"
					className="ml-auto"
					aria-pressed={focused}
					onClick={() =>
						onFocus(focused ? null : { parentStepId: step.id, itemId: null })
					}
				>
					<ScanSearchIcon data-icon="inline-start" />
					{focused ? "Show the whole run" : "Show its steps and graph"}
				</Button>
			</header>
			<div className="grid gap-4 xl:grid-cols-2">
				<Card size="sm">
					<CardHeader>
						<CardTitle>Inputs</CardTitle>
					</CardHeader>
					<CardContent>
						{declared.length === 0 && bindings.length === 0 ? (
							<p className="text-muted-foreground text-xs italic">None</p>
						) : (
							<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
								{(declared.length > 0
									? declared.map((input) => input.name)
									: bindings.map(([name]) => name)
								).map((name) => {
									const template =
										node?.type === "subflow" ? node.inputs[name] : undefined;
									const input = declared.find((one) => one.name === name);
									return (
										<div key={name} className="contents">
											<dt className="font-mono text-muted-foreground">
												{name}
											</dt>
											<dd className="break-words font-mono">
												{template ?? (
													<span className="font-sans text-muted-foreground italic">
														{input?.default !== undefined
															? `default: ${input.default}`
															: "not bound"}
													</span>
												)}
											</dd>
										</div>
									);
								})}
							</dl>
						)}
					</CardContent>
				</Card>
				<Card size="sm">
					<CardHeader>
						<CardTitle>Returned</CardTitle>
					</CardHeader>
					<CardContent>
						{returned.length === 0 ? (
							<p className="text-muted-foreground text-xs italic">
								{step.outcome === null
									? "Not yet: it is running."
									: "No outputs."}
							</p>
						) : (
							<dl className="flex flex-col gap-3 text-xs">
								{returned.map(([field, value]) => {
									const json = jsonOutput(value);
									return (
										<div key={field} className="flex min-w-0 flex-col gap-1.5">
											<dt className="font-mono text-muted-foreground">
												{`{{${step.nodeId}.${field}}}`}
											</dt>
											<dd className="min-w-0">
												{json !== undefined ? (
													<JsonBlock value={json} className="max-h-40" />
												) : String(value) ? (
													<CodeView code={String(value)} language="text" />
												) : (
													<span className="text-muted-foreground italic">
														empty
													</span>
												)}
											</dd>
										</div>
									);
								})}
							</dl>
						)}
					</CardContent>
				</Card>
			</div>
		</section>
	);
}
