/** A subagent the agent started: the Subagent pattern of AI Elements, on Trace. */
import { isLaunchNotice, subagentTask } from "@nightshift/client";
import { Badge } from "@nightshift/ui/components/badge";
import {
	Trace,
	TraceCollapsible,
	TraceCollapsibleContent,
	TraceCollapsibleTrigger,
	TraceDescription,
	TraceIcon,
	TraceLine,
	TraceTitle,
} from "@nightshift/ui/components/trace";
import { BotIcon } from "lucide-react";
import { memo, useState } from "react";
import { formatDuration } from "@/shared/format";
import { Markdown } from "@/shared/markdown";
import type { MessageItem, ToolItem } from "../transcript-items";
import { Reasoning } from "./reasoning";
import { ToolCallRow } from "./tool-call-row";

/** A call that started a subagent: Claude Code's Agent (or Task) tool. */
export function isSubagentCall(item: ToolItem): boolean {
	return item.hasInput && subagentTask(item.name, item.input) !== null;
}

/**
 * The subagent's answer and whether it still works. A subagent that runs
 * in the background answers with its last message. Any other answers with
 * the call's result.
 */
function subagentState(item: ToolItem, running: boolean) {
	const steps = item.steps ?? [];
	const last = steps.at(-1);
	const background = item.result !== undefined && isLaunchNotice(item.result);
	const answer: MessageItem | undefined =
		background && last?.kind === "message" ? last : undefined;
	const working =
		running &&
		(item.result === undefined || (background && answer === undefined));
	const result = background ? answer?.text : item.result;
	return {
		working,
		result,
		// The answer is shown as the result, not as a step.
		steps: answer ? steps.slice(0, -1) : steps,
	};
}

/**
 * "Ran the Explore agent", with how long it took. It opens on the task,
 * the model when the call named one, the subagent's tool calls and
 * thoughts, and its answer. It is open while the subagent works.
 */
export const SubagentRun = memo(function SubagentRun({
	item,
	running,
}: {
	item: ToolItem;
	/** The step still runs. */
	running: boolean;
}) {
	const [open, setOpen] = useState<boolean>();
	const task = subagentTask(item.name, item.input);
	const { working, result, steps } = subagentState(item, running);
	const failed = !working && item.failed === true;
	const agent = task?.agent ? `the ${task.agent} agent` : "an agent";
	const title = working
		? `Running ${agent}`
		: failed
			? `Could not run ${agent}`
			: `Ran ${agent}`;
	const end = Math.max(item.endedAt ?? 0, item.lastAt ?? 0);
	const took = !working && end > item.at ? formatDuration(end - item.at) : null;

	return (
		<Trace>
			<TraceCollapsible open={open ?? working} onOpenChange={setOpen}>
				<TraceCollapsibleTrigger>
					<TraceLine
						status={working ? "running" : failed ? "error" : undefined}
						className="text-xs"
					>
						<TraceIcon>
							<BotIcon className="size-3.5" />
						</TraceIcon>
						<TraceTitle>{title}</TraceTitle>
						{task?.description ? (
							<TraceDescription className="min-w-0 shrink truncate">
								{task.description}
							</TraceDescription>
						) : null}
						{took ? <TraceDescription>· {took}</TraceDescription> : null}
					</TraceLine>
				</TraceCollapsibleTrigger>
				<TraceCollapsibleContent
					keepMounted
					className="flex flex-col gap-3 text-xs"
				>
					{task?.prompt ? (
						<Markdown text={task.prompt} className="max-w-none text-xs" />
					) : null}
					{task?.model ? (
						<div className="flex flex-wrap gap-1">
							<Badge variant="secondary">{task.model}</Badge>
						</div>
					) : null}
					{steps.length > 0 ? (
						<div className="flex flex-col gap-2">
							{steps.map((step) =>
								step.kind === "tool" ? (
									<ToolCallRow key={step.key} item={step} running={working} />
								) : step.kind === "thinking" ? (
									<Reasoning key={step.key} item={step} running={working} />
								) : (
									<Markdown
										key={step.key}
										text={step.text}
										className="max-w-none text-xs"
									/>
								),
							)}
						</div>
					) : null}
					{result !== undefined && result.trim() !== "" ? (
						<section className="flex flex-col gap-1.5">
							<h4 className="font-medium">Answer</h4>
							<Markdown text={result} className="max-w-none text-xs" />
						</section>
					) : working ? null : (
						<p>No answer.</p>
					)}
				</TraceCollapsibleContent>
			</TraceCollapsible>
		</Trace>
	);
});
