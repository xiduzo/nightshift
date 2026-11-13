import type { AskWhy } from "@nightshift/client";
import { Link } from "@tanstack/react-router";
import { chatAboutRun } from "@/features/flows";
import { AgentButton } from "@/shared/agent-button";

/**
 * "Improve this flow": opens the run's flow with a chat about the run. The
 * Improver reads the run and proposes a change to the flow. Off, with the
 * reason, where it cannot work. "Ask why" answers in place instead.
 */
export function ImproveFlowButton({
	runId,
	ask,
}: {
	runId: string;
	ask: AskWhy;
}) {
	if (ask.kind === "hidden") return null;
	if (ask.kind === "disabled") {
		return (
			<>
				<AgentButton entry="run.improve" disabled />
				<span className="self-center text-muted-foreground text-xs">
					{ask.reason}
				</span>
			</>
		);
	}
	return (
		<AgentButton
			entry="run.improve"
			title="Opens the flow with a chat. The Improver reads this run and proposes a change."
			link={
				<Link
					to="/projects/$projectId/flows/$name"
					params={{ projectId: ask.projectId, name: ask.flowName }}
					search={{ chat: chatAboutRun(runId) }}
				/>
			}
		/>
	);
}
