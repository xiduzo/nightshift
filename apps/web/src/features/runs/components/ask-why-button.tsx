import type { AskWhy } from "@nightshift/client";
import { Button } from "@nightshift/ui/components/button";
import { Link } from "@tanstack/react-router";
import { SparklesIcon } from "lucide-react";
import { chatAboutRun } from "@/features/flows";

/**
 * "Ask an agent why": opens the run's flow with a chat about the run. The
 * agent reads the run, explains what went wrong and proposes a change to
 * the flow. Off, with the reason, where it cannot work.
 */
export function AskWhyButton({ runId, ask }: { runId: string; ask: AskWhy }) {
	if (ask.kind === "hidden") return null;
	if (ask.kind === "disabled") {
		return (
			<>
				<Button size="sm" variant="outline" disabled>
					<SparklesIcon data-icon="inline-start" />
					Ask an agent why
				</Button>
				<span className="self-center text-muted-foreground text-xs">
					{ask.reason}
				</span>
			</>
		);
	}
	return (
		<Button
			size="sm"
			variant="outline"
			nativeButton={false}
			title="Opens the flow with a chat. The agent reads this run and proposes a fix."
			render={
				<Link
					to="/projects/$projectId/flows/$name"
					params={{ projectId: ask.projectId, name: ask.flowName }}
					search={{ chat: chatAboutRun(runId) }}
				/>
			}
		>
			<SparklesIcon data-icon="inline-start" />
			Ask an agent why
		</Button>
	);
}
