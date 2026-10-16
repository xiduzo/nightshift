import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "@nightshift/ui/components/empty";
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
		<div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 md:px-6">
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
				<Empty className="py-8">
					<EmptyHeader>
						<EmptyTitle className="text-sm">
							{step.outcome === null ? "Still running" : "Nothing to sum up"}
						</EmptyTitle>
						<EmptyDescription className="text-xs">
							{step.outcome === null
								? "The summary shows when the step ends. The transcript follows it live."
								: "This step left no summary. The transcript shows what it did."}
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			)}
		</div>
	);
}
