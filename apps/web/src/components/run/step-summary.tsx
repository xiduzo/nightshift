import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import { CircleXIcon } from "lucide-react";
import type { ReactNode } from "react";

import type { RunDetail, StepSummary as Step } from "@/lib/api-types";
import type { ItemScope } from "@/lib/run-steps";

import { ItemList } from "./item-list";
import { CodeView } from "./json-block";
import { stepProse } from "./step-header";
import { SubflowDetail } from "./subflow-detail";

/**
 * What a step did, without the transcript: why it failed, what it said it
 * did, its command's last output, the elements of a For Each, or the flow a
 * Subflow called.
 */
export function StepSummary({
	run,
	steps,
	step,
	focus,
	onSelectItem,
	context,
}: {
	run: RunDetail;
	steps: Step[];
	step: Step;
	/** The call in focus, to mark the element or called flow it is. */
	focus: ItemScope;
	onSelectItem: (scope: ItemScope) => void;
	/** Where the step ran, for a step inside a called flow. */
	context?: ReactNode;
}) {
	const prose = stepProse(step);
	const logTail =
		step.nodeType === "command" && typeof step.outputs.log_tail === "string"
			? step.outputs.log_tail.trim()
			: "";
	const exitCode = step.outputs.exit_code;
	const hasBody =
		step.error ||
		prose ||
		logTail ||
		step.nodeType === "foreach" ||
		step.nodeType === "subflow";

	return (
		<div className="flex min-w-0 flex-col gap-4">
			{context ? (
				<div className="min-w-0 text-muted-foreground text-xs">{context}</div>
			) : null}
			{step.error ? (
				<Alert variant="destructive">
					<CircleXIcon aria-hidden="true" />
					<AlertTitle>Why it failed</AlertTitle>
					<AlertDescription className="whitespace-pre-wrap break-words">
						{step.error}
					</AlertDescription>
				</Alert>
			) : null}
			{prose ? (
				<p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
					{prose}
				</p>
			) : null}
			{logTail ? (
				<CodeView
					code={logTail}
					language="text"
					title={
						exitCode === undefined || exitCode === ""
							? "Last output"
							: `Last output · exit ${String(exitCode)}`
					}
				/>
			) : null}
			{step.nodeType === "foreach" ? (
				<div className="overflow-hidden rounded-lg border">
					<ItemList
						step={step}
						steps={steps}
						selectedItem={focus}
						onSelectItem={onSelectItem}
					/>
				</div>
			) : null}
			{step.nodeType === "subflow" ? (
				<div className="overflow-hidden rounded-lg border">
					<SubflowDetail
						run={run}
						steps={steps}
						step={step}
						focused={focus?.parentStepId === step.id && focus.itemId === null}
						onFocus={onSelectItem}
					/>
				</div>
			) : null}
			{hasBody ? null : (
				<p className="text-muted-foreground text-xs">
					{step.outcome === null
						? "Still running. The summary shows when the step ends; the transcript follows it live."
						: "This step left no summary. The transcript shows what it did."}
				</p>
			)}
		</div>
	);
}
