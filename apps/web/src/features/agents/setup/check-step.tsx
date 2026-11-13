import { Button } from "@nightshift/ui/components/button";
import {
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@nightshift/ui/components/dialog";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { Spinner } from "@nightshift/ui/components/spinner";
import { Link } from "@tanstack/react-router";
import {
	CircleAlertIcon,
	CircleCheckIcon,
	CircleDashedIcon,
} from "lucide-react";
import {
	agentNames,
	allAnswer,
	answeredIn,
	type CheckFix,
	checkFix,
} from "./check-state";
import { useAnsweredBy } from "./try-agent-button";
import { type CheckedRow, useAgentChecks } from "./use-agent-checks";

/**
 * The check step of the setup: one small question to what answers for each
 * of Night Shift's agents. Each row shows its result. A row that failed
 * says what happened and offers its fix. Like the other steps, it draws
 * the header, the body and the footer of the setup dialog.
 */
export function CheckStep({
	onFix,
	onSkip,
	onContinue,
}: {
	/** Opens the step that fixes a failed row: the agent, or the model. */
	onFix: (step: "agent" | "model") => void;
	onSkip: () => void;
	/** After a check: the next step. */
	onContinue: () => void;
}) {
	const { loading, rows, summary, asking, run } = useAgentChecks();
	const some = rows.some((row) => row.result !== null && !row.row.blocked);
	return (
		<>
			<DialogHeader>
				<DialogTitle>Check Night Shift's agents</DialogTitle>
				<DialogDescription>
					Night Shift asks each agent one small question. The check costs a few
					cents at most.
				</DialogDescription>
			</DialogHeader>
			{loading ? (
				<div className="flex flex-col gap-2" aria-hidden>
					<Skeleton className="h-14 w-full" />
					<Skeleton className="h-14 w-full" />
					<Skeleton className="h-14 w-full" />
				</div>
			) : (
				<ItemGroup className="gap-2" aria-live="polite">
					{rows.map((row) => (
						<CheckItem key={row.row.ask} row={row} onFix={onFix} />
					))}
				</ItemGroup>
			)}
			<DialogFooter>
				{allAnswer(summary) ? null : (
					<Button variant="outline" disabled={asking} onClick={onSkip}>
						Skip
					</Button>
				)}
				{allAnswer(summary) ? (
					<Button onClick={onContinue}>Continue</Button>
				) : (
					<Button disabled={loading || asking} onClick={run}>
						{asking ? <Spinner data-icon="inline-start" /> : null}
						{asking ? "Asking…" : some ? "Check again" : "Check now"}
					</Button>
				)}
			</DialogFooter>
		</>
	);
}

/** The button of a fix: a step of the setup, or the agent's page in Settings. */
function FixButton({
	fix,
	onFix,
}: {
	fix: CheckFix;
	onFix: (step: "agent" | "model") => void;
}) {
	if (fix.kind === "settings") {
		return (
			<Button
				size="sm"
				variant="outline"
				nativeButton={false}
				render={
					<Link
						to="/settings"
						search={{ section: "builtin", agent: fix.agent }}
					/>
				}
			>
				Open Settings
			</Button>
		);
	}
	return (
		<Button size="sm" variant="outline" onClick={() => onFix(fix.kind)}>
			{fix.kind === "agent" ? "Set up the agent" : "Set up the model"}
		</Button>
	);
}

/** One question: the agents it covers, what answers, and how it went. */
function CheckItem({
	row: { row, result, asking, error },
	onFix,
}: {
	row: CheckedRow;
	onFix: (step: "agent" | "model") => void;
}) {
	const by = useAnsweredBy();
	const what = by(result?.answers ?? row.answers);
	const fix = result && !asking ? checkFix(result) : null;
	const failed = !asking && (error !== null || result?.ok === false);
	return (
		<Item variant="outline" size="sm">
			<ItemMedia variant="icon">
				{asking ? (
					<Spinner />
				) : failed ? (
					<CircleAlertIcon className="text-destructive" />
				) : result?.ok ? (
					<CircleCheckIcon className="text-status-finished" />
				) : (
					<CircleDashedIcon className="text-muted-foreground" />
				)}
			</ItemMedia>
			<ItemContent className="min-w-0">
				<ItemTitle>{agentNames(row.ids)}</ItemTitle>
				<ItemDescription className="line-clamp-none break-words">
					{asking
						? `Asking ${what ?? "it"}…`
						: error !== null
							? `The check did not run. ${error}`
							: result?.ok
								? `${answeredIn(result.ms)}${what ? ` · ${what}` : ""}`
								: (result?.problem ?? what ?? "")}
				</ItemDescription>
			</ItemContent>
			{fix ? (
				<ItemActions>
					<FixButton fix={fix} onFix={onFix} />
				</ItemActions>
			) : null}
		</Item>
	);
}
