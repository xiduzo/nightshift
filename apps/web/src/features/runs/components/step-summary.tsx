import { standInLabel, waitedText } from "@nightshift/client";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import {
	Item,
	ItemContent,
	ItemDescription,
	ItemMedia,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { Link } from "@tanstack/react-router";
import { CircleXIcon, PinIcon, SkipForwardIcon } from "lucide-react";
import type { ReactNode } from "react";

import type { RunDetail, StepSummary as Step } from "@/shared/api";
import { CodeView } from "@/shared/code";
import { formatDayTime } from "@/shared/format";
import { LocalTime } from "@/shared/time";
import { type ItemScope, stepRunsEach } from "../lib/run-steps";
import { stepProse } from "../lib/step-gist";
import { CallDetail } from "./call-detail";
import { ItemList } from "./item-list";
import { StepClimb } from "./step-climb";

/**
 * A step of a test run that stood in for its node: where its pinned
 * output comes from, or that the node was skipped.
 */
function StandIn({
	step,
	test,
}: {
	step: Step;
	test: NonNullable<Step["test"]>;
}) {
	const from = step.pinnedFrom;
	return (
		<Item variant="outline" size="sm">
			<ItemMedia variant="icon">
				{test === "pinned" ? <PinIcon /> : <SkipForwardIcon />}
			</ItemMedia>
			<ItemContent>
				<ItemTitle>{standInLabel(test)}</ItemTitle>
				<ItemDescription>
					{test === "skipped" ? (
						"The node did not run. It gave the outcome you chose."
					) : from ? (
						<>
							From the run of{" "}
							<Link
								to="/runs/$runId"
								params={{ runId: from.runId }}
								search={{ step: from.stepId }}
							>
								<LocalTime at={from.endedAt}>
									{formatDayTime(from.endedAt)}
								</LocalTime>
							</Link>
							. The node did not run.
						</>
					) : (
						"The node did not run."
					)}
				</ItemDescription>
			</ItemContent>
		</Item>
	);
}

/**
 * What a step did, without the transcript: that it stood in for its node
 * in a test run, why it failed, what it said it did, its command's last
 * output, the elements a Call step ran, or the flow it called.
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
		(step.nodeType === "command" || step.nodeType === "wait") &&
		typeof step.outputs.log_tail === "string"
			? step.outputs.log_tail.trim()
			: "";
	const exitCode = step.outputs.exit_code;
	const each = stepRunsEach(run, steps, step);
	const waited =
		step.nodeType === "wait" && typeof step.outputs.waited_minutes === "number"
			? step.outputs.waited_minutes
			: null;
	const hasBody =
		step.test ||
		step.error ||
		prose ||
		logTail ||
		waited !== null ||
		step.nodeType === "call";

	return (
		<div className="flex min-w-0 flex-col gap-4">
			{context ? (
				<div className="min-w-0 text-muted-foreground text-xs">{context}</div>
			) : null}
			{step.test ? <StandIn step={step} test={step.test} /> : null}
			<StepClimb steps={steps} step={step} runStatus={run.status} />
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
			{waited !== null ? (
				<p className="text-sm leading-relaxed">
					{step.outcome === "timeout"
						? `Timed out after ${waitedText(waited * 60_000)}.`
						: step.outcome === null
							? `Waiting for ${waitedText(waited * 60_000)} so far.`
							: `Waited ${waitedText(waited * 60_000)}.`}
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
			{step.nodeType === "call" && each ? (
				<div className="overflow-hidden rounded-lg border">
					<ItemList
						runId={run.id}
						step={step}
						steps={steps}
						selectedItem={focus}
						onSelectItem={onSelectItem}
					/>
				</div>
			) : null}
			{step.nodeType === "call" && !each ? (
				<div className="overflow-hidden rounded-lg border">
					<CallDetail
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
						? "The summary shows when the step ends. Follow the step live in the transcript."
						: "This step left no summary. The transcript shows what it did."}
				</p>
			)}
		</div>
	);
}
