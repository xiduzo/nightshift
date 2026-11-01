import { Button } from "@nightshift/ui/components/button";
import {
	HoverCard,
	HoverCardContent,
	HoverCardTrigger,
} from "@nightshift/ui/components/hover-card";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { stepGist, WorkTime } from "@/features/runs/flows-port";
import type { RunStatus, StepSummary } from "@/shared/api";
import { formatStepUsage } from "@/shared/format";
import { hasCost } from "../canvas/node-type";
import { OutcomeBadge, stepState } from "../canvas/outcome-badge";

/**
 * A step of the run that the agent's answer cites (the AI Elements Inline
 * Citation): the step's name in the sentence. Pointing at it shows the
 * step's outcome, how long it took, what it cost and what it did. A click
 * opens the run at that step. A step the run does not have shows as text.
 */
export function StepCitation({
	runId,
	runStatus,
	step,
	children,
}: {
	runId: string;
	runStatus: RunStatus | undefined;
	/** The cited step, or undefined when the run has no such step. */
	step: StepSummary | undefined;
	/** The text of the link, as the agent wrote it. */
	children: ReactNode;
}) {
	if (!step) return <>{children}</>;
	const gist = stepGist(step);
	const target = (
		<Link to="/runs/$runId" params={{ runId }} search={{ step: step.id }} />
	);
	return (
		<HoverCard>
			<HoverCardTrigger
				delay={10}
				closeDelay={100}
				render={
					<Button
						variant="secondary"
						size="xs"
						nativeButton={false}
						className="max-w-48 align-baseline font-mono"
						render={target}
					/>
				}
			>
				<span className="truncate">{step.nodeId}</span>
			</HoverCardTrigger>
			<HoverCardContent className="flex w-64 flex-col gap-1">
				<div className="flex min-w-0 items-center justify-between gap-2">
					<span className="truncate font-medium font-mono">{step.nodeId}</span>
					<OutcomeBadge
						state={stepState(step, runStatus)}
						className="shrink-0"
					/>
				</div>
				<p className="text-muted-foreground text-xs tabular-nums">
					{step.visit > 1 ? `Visit ${step.visit} · ` : null}
					<WorkTime steps={[step]} start={step.startedAt} />
					{hasCost(step) ? ` · ${formatStepUsage(step)}` : null}
				</p>
				{gist ? <p className="line-clamp-3 text-xs">{gist}</p> : null}
			</HoverCardContent>
		</HoverCard>
	);
}
