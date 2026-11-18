import type { Todo } from "@nightshift/client";
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
import { cn } from "@nightshift/ui/lib/utils";
import {
	CircleCheckIcon,
	CircleDotIcon,
	CircleIcon,
	CircleSlashIcon,
	ListTodoIcon,
} from "lucide-react";

/**
 * The agent's to-do list, as the AI Elements Plan: the title counts the
 * items done, each item is done, in progress or still to do. It follows the
 * agent's newest list while the step runs.
 */
export function StepPlan({
	todos,
	running,
}: {
	todos: Todo[];
	/** The step still runs: the item in progress shimmers. */
	running: boolean;
}) {
	const counted = todos.filter((todo) => todo.status !== "cancelled");
	const done = counted.filter((todo) => todo.status === "completed").length;
	const working =
		running && todos.some((todo) => todo.status === "in_progress");
	return (
		<section aria-label="To-do list">
			<Trace>
				<TraceCollapsible defaultOpen>
					<TraceCollapsibleTrigger>
						<TraceLine status={working ? "running" : undefined}>
							<TraceIcon>
								<ListTodoIcon />
							</TraceIcon>
							<TraceTitle className="font-medium text-foreground">
								To-do list
							</TraceTitle>
							<TraceDescription className="tabular-nums">
								{done} of {counted.length} done
							</TraceDescription>
						</TraceLine>
					</TraceCollapsibleTrigger>
					<TraceCollapsibleContent>
						<Trace>
							{todos.map((todo, index) => (
								<PlanItem key={index} todo={todo} running={running} />
							))}
						</Trace>
					</TraceCollapsibleContent>
				</TraceCollapsible>
			</Trace>
		</section>
	);
}

function PlanItem({ todo, running }: { todo: Todo; running: boolean }) {
	if (todo.status === "completed") {
		return (
			<TraceLine>
				<TraceIcon>
					<CircleCheckIcon className="text-status-finished" />
				</TraceIcon>
				<TraceTitle>{todo.content}</TraceTitle>
				<span className="sr-only">Done</span>
			</TraceLine>
		);
	}
	if (todo.status === "in_progress") {
		// Its "doing" words while the step runs; its plain words once it ended.
		return (
			<TraceLine status={running ? "running" : undefined}>
				<TraceIcon>
					<CircleDotIcon className="text-status-running" />
				</TraceIcon>
				<TraceTitle className="text-foreground">
					{running ? (todo.activeForm ?? todo.content) : todo.content}
				</TraceTitle>
				<span className="sr-only">In progress</span>
			</TraceLine>
		);
	}
	const cancelled = todo.status === "cancelled";
	return (
		<TraceLine status="pending">
			<TraceIcon>{cancelled ? <CircleSlashIcon /> : <CircleIcon />}</TraceIcon>
			<TraceTitle className={cn(cancelled && "line-through")}>
				{todo.content}
			</TraceTitle>
			<span className="sr-only">{cancelled ? "Dropped" : "To do"}</span>
		</TraceLine>
	);
}
