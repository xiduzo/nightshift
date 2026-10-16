import { ScanSearchIcon } from "lucide-react";

import type { RunDetail, StepSummary } from "@/lib/api-types";
import {
	calledFlowOf,
	type ItemScope,
	jsonOutput,
	nodeOfStep,
	stepsIn,
} from "@/lib/run-steps";

import { JsonBlock } from "./json-block";

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
		<section
			aria-label="The called flow"
			className="flex max-h-[40vh] min-h-0 flex-col gap-2 overflow-y-auto border-b px-4 py-2 text-xs"
		>
			<header className="flex flex-wrap items-center gap-2">
				<h3 className="font-medium">
					Called{" "}
					<span className="font-mono">
						{node?.type === "subflow" ? node.flow : "a flow"}
					</span>
				</h3>
				<span className="text-muted-foreground">
					{childCount} {childCount === 1 ? "step" : "steps"}
					{typeof ended === "string" && ended !== ""
						? ` · ended on ${ended}`
						: ""}
				</span>
				<button
					type="button"
					aria-pressed={focused}
					onClick={() =>
						onFocus(focused ? null : { parentStepId: step.id, itemId: null })
					}
					className="ml-auto flex items-center gap-1 text-muted-foreground underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-1 focus-visible:ring-ring"
				>
					<ScanSearchIcon className="size-3.5" aria-hidden="true" />
					{focused ? "Show the whole run" : "Show its steps and graph"}
				</button>
			</header>
			<div className="grid gap-3 md:grid-cols-2">
				<div className="flex min-w-0 flex-col gap-1">
					<h4 className="text-muted-foreground">Inputs</h4>
					{declared.length === 0 && bindings.length === 0 ? (
						<p className="text-muted-foreground italic">None</p>
					) : (
						<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1">
							{(declared.length > 0
								? declared.map((input) => input.name)
								: bindings.map(([name]) => name)
							).map((name) => {
								const template =
									node?.type === "subflow" ? node.inputs[name] : undefined;
								const input = declared.find((one) => one.name === name);
								return (
									<div key={name} className="contents">
										<dt className="font-mono text-muted-foreground">{name}</dt>
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
				</div>
				<div className="flex min-w-0 flex-col gap-1">
					<h4 className="text-muted-foreground">Returned</h4>
					{returned.length === 0 ? (
						<p className="text-muted-foreground italic">
							{step.outcome === null
								? "Not yet: it is running."
								: "No outputs."}
						</p>
					) : (
						<dl className="flex flex-col gap-1.5">
							{returned.map(([field, value]) => {
								const json = jsonOutput(value);
								return (
									<div key={field} className="flex min-w-0 flex-col gap-0.5">
										<dt className="font-mono text-muted-foreground">
											{`{{${step.nodeId}.${field}}}`}
										</dt>
										<dd className="min-w-0">
											{json !== undefined ? (
												<JsonBlock value={json} className="max-h-40" />
											) : (
												<span className="whitespace-pre-wrap break-words font-mono">
													{String(value) || (
														<span className="text-muted-foreground italic">
															empty
														</span>
													)}
												</span>
											)}
										</dd>
									</div>
								);
							})}
						</dl>
					)}
				</div>
			</div>
		</section>
	);
}
