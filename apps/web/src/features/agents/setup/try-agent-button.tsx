import type { BuiltinAgentId, BuiltinCheck } from "@nightshift/flows";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import { Button } from "@nightshift/ui/components/button";
import { Spinner } from "@nightshift/ui/components/spinner";
import { cn } from "@nightshift/ui/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlertIcon, CircleCheckIcon, PlayIcon } from "lucide-react";
import { harnessInfo, useCustomAgents } from "../harnesses";
import { builtinQueries } from "../queries";
import { answeredBy, answeredIn } from "./check-state";

/** What answered, in one line, with the names the pickers use. */
export function useAnsweredBy(): (
	answers: BuiltinCheck["answers"],
) => string | null {
	const customAgents = useCustomAgents();
	return (answers) =>
		answeredBy(answers, (harness) => harnessInfo(harness, customAgents).label);
}

/**
 * "Try it" for one of Night Shift's agents: asks what answers for it one
 * small question, and shows the result in place. It answered, how fast and
 * what answered, or the problem and what to do.
 */
export function TryAgentButton({
	agent,
	className,
}: {
	/** The built-in agent to check. */
	agent: BuiltinAgentId;
	className?: string;
}) {
	const queryClient = useQueryClient();
	const check = useQuery(builtinQueries.check(agent));
	const asking = check.isFetching;
	const tried = check.data !== undefined || check.error !== null;
	return (
		<div className={cn("flex flex-col items-start gap-2", className)}>
			<Button
				variant="outline"
				size="sm"
				disabled={asking}
				onClick={() =>
					void queryClient
						.fetchQuery({ ...builtinQueries.check(agent), staleTime: 0 })
						.catch(() => {})
				}
			>
				{asking ? (
					<Spinner data-icon="inline-start" />
				) : (
					<PlayIcon data-icon="inline-start" />
				)}
				{asking ? "Asking…" : tried ? "Try again" : "Try it"}
			</Button>
			<div aria-live="polite" className="w-full empty:hidden">
				{asking ? null : (
					<CheckOutcome
						result={check.data ?? null}
						error={check.error?.message ?? null}
					/>
				)}
			</div>
		</div>
	);
}

/** The result of one check: it answered, or the problem and what to do. */
export function CheckOutcome({
	result,
	error,
}: {
	result: BuiltinCheck | null;
	/** The check itself did not run. */
	error: string | null;
}) {
	const by = useAnsweredBy();
	if (error !== null) {
		return (
			<Alert variant="destructive">
				<CircleAlertIcon />
				<AlertTitle>The check did not run</AlertTitle>
				<AlertDescription>{error}</AlertDescription>
			</Alert>
		);
	}
	if (!result) return null;
	const what = by(result.answers);
	if (result.ok) {
		return (
			<p className="flex items-center gap-2 text-sm">
				<CircleCheckIcon className="size-4 shrink-0 text-status-finished" />
				<span>
					{answeredIn(result.ms)}
					{what ? (
						<span className="text-muted-foreground"> · {what}</span>
					) : null}
				</span>
			</p>
		);
	}
	return (
		<Alert variant="destructive">
			<CircleAlertIcon />
			<AlertTitle>
				{what ? `No answer from ${what}` : "Nothing can answer"}
			</AlertTitle>
			<AlertDescription>{result.problem}</AlertDescription>
		</Alert>
	);
}
