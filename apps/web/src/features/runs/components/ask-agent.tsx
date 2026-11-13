import {
	askWhyMutation,
	explainRun,
	isMissingOnHost,
} from "@nightshift/client";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import { Spinner } from "@nightshift/ui/components/spinner";
import { useMutation, useMutationState } from "@tanstack/react-query";
import { MessageCircleQuestionIcon } from "lucide-react";
import { useState } from "react";

import { AgentButton } from "@/shared/agent-button";
import { client } from "@/shared/api";
import { Markdown } from "@/shared/markdown";

/** The last ask about one run, as the mutation cache keeps it. */
type LastAsk = {
	status: "idle" | "pending" | "success" | "error";
	answer: string | undefined;
	error: Error | null;
};

/** "Ask why" for one run: the button and the answer share it. */
export type AgentAsk = {
	ask: () => void;
	last: LastAsk | undefined;
	activity: string | null;
	/** The computer that answers does not have it (an older Host). */
	missing: boolean;
};

/**
 * One answer about a run, in place: no chat and no change to the flow.
 * The answer stays in the mutation cache, so it shows again when the run
 * page opens again. Each ask costs a model call.
 */
export function useAgentAsk(runId: string): AgentAsk {
	const [activity, setActivity] = useState<string | null>(null);
	const options = askWhyMutation(client, runId);
	const mutation = useMutation({
		...options,
		mutationFn: () => {
			setActivity(null);
			return explainRun(client, runId, { onActivity: setActivity });
		},
	});
	const asks = useMutationState({
		filters: { mutationKey: options.mutationKey },
		select: (m): LastAsk => ({
			status: m.state.status,
			answer: m.state.data as string | undefined,
			error: m.state.error,
		}),
	});
	const last = asks.at(-1);
	return {
		ask: () => mutation.mutate(),
		last,
		activity,
		missing: Boolean(last?.error && isMissingOnHost(last.error)),
	};
}

/** "Ask why": the Explainer reads the run and tells you what went wrong. */
export function AskAgentButton({ agent }: { agent: AgentAsk }) {
	if (agent.missing) return null;
	const pending = agent.last?.status === "pending";
	const asked = agent.last !== undefined && agent.last.status !== "idle";
	return (
		<AgentButton
			entry="run.why"
			again={asked && !pending}
			disabled={pending}
			title="An agent reads this run and tells you what went wrong."
			onClick={agent.ask}
		/>
	);
}

/** The answer of "Ask why", while it comes and once it is there. */
export function AgentAnswer({
	agent,
	failed,
}: {
	agent: AgentAsk;
	failed: boolean;
}) {
	const { last, activity } = agent;
	if (!last || last.status === "idle" || agent.missing) return null;

	if (last.status === "pending") {
		return (
			<div
				className="flex items-center gap-3 rounded-md border p-3"
				aria-live="polite"
			>
				<Spinner className="text-muted-foreground" />
				<div className="flex min-w-0 flex-col gap-0.5">
					<span className="text-sm">The agent reads the run.</span>
					<span className="truncate text-muted-foreground text-xs">
						{activity ?? "This can take a minute."}
					</span>
				</div>
			</div>
		);
	}

	if (last.status === "error" || !last.answer) {
		return (
			<Alert variant="destructive">
				<AlertTitle>No answer came</AlertTitle>
				<AlertDescription>{last.error?.message ?? ""}</AlertDescription>
			</Alert>
		);
	}

	return (
		<section className="flex flex-col gap-2 rounded-md border p-3">
			<h3 className="flex items-center gap-2 font-medium text-sm">
				<MessageCircleQuestionIcon
					className="size-4 text-muted-foreground"
					aria-hidden="true"
				/>
				{failed ? "Why it failed" : "Why it stopped"}
			</h3>
			<Markdown text={last.answer} className="max-w-none text-sm" />
		</section>
	);
}
