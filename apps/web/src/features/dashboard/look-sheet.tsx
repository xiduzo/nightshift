import {
	type FlowSignal,
	signalFacts,
	signalTitle,
	type WatchedFlow,
} from "@nightshift/client";
import { Button } from "@nightshift/ui/components/button";
import { Separator } from "@nightshift/ui/components/separator";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from "@nightshift/ui/components/sheet";
import { Link } from "@tanstack/react-router";
import { CheckIcon } from "lucide-react";
import { AgentAnswer, AskAgentButton, useAgentAsk } from "@/features/runs";
import {
	formatCost,
	formatDuration,
	formatRelative,
	useNow,
} from "@/shared/format";
import { LocalTime } from "@/shared/time";
import { LevelBadge, SignalIcon, UsualRange } from "./watch-parts";

/**
 * One flow that needs a look, beside Home: what is unusual against its
 * usual range, an agent that reads the run, and where to go. **Looked at
 * it** folds the flow on Home until it changes.
 */
export function LookSheet({
	flow,
	projectName,
	open,
	onOpenChange,
	onLooked,
}: {
	/** Stays while the Sheet closes, so its body does not go blank. */
	flow: WatchedFlow | undefined;
	projectName: string | undefined;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onLooked: () => void;
}) {
	const first = flow?.signals[0];
	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent className="w-full gap-0 sm:max-w-xl">
				{flow && first ? (
					<>
						<SheetHeader>
							<SheetTitle>{flow.flow}</SheetTitle>
							<SheetDescription className="flex flex-wrap items-center gap-2">
								{projectName}
								{flow.level ? <LevelBadge level={flow.level.level} /> : null}
							</SheetDescription>
						</SheetHeader>
						<div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 pb-6">
							{flow.signals.map((signal) => (
								<SignalCard key={signal.kind} signal={signal} />
							))}
						</div>
						<SheetFooter className="flex-row flex-wrap border-t">
							<Button
								nativeButton={false}
								render={
									<Link to="/runs/$runId" params={{ runId: first.runId }} />
								}
							>
								Open the run
							</Button>
							<Button
								variant="outline"
								nativeButton={false}
								render={
									<Link
										to="/projects/$projectId/flows/$name"
										params={{ projectId: flow.projectId, name: flow.flow }}
									/>
								}
							>
								Open the flow
							</Button>
							<Button variant="outline" onClick={onLooked}>
								<CheckIcon data-icon="inline-start" />
								Looked at it
							</Button>
						</SheetFooter>
					</>
				) : null}
			</SheetContent>
		</Sheet>
	);
}

/** One signal: what is unusual, its usual range, and an agent for a failed run. */
function SignalCard({ signal }: { signal: FlowSignal }) {
	const now = useNow(60_000);
	const facts = signalFacts(signal, {
		cost: formatCost,
		time: formatDuration,
	});
	return (
		<section className="flex flex-col gap-3">
			<h3 className="flex items-center gap-2 font-medium text-lg">
				<SignalIcon signal={signal} />
				{signalTitle(signal)}
			</h3>
			<div className="flex flex-col gap-3 rounded-xl border p-4">
				<UsualRange signal={signal} />
				<dl className="grid grid-cols-[5rem_1fr] gap-y-1 text-sm">
					{facts ? (
						<>
							<dt className="text-muted-foreground">Usual</dt>
							<dd>{facts.usual}</dd>
							<dt className="text-muted-foreground">Now</dt>
							<dd className="font-medium">{facts.now}</dd>
						</>
					) : null}
					<dt className="text-muted-foreground">Since</dt>
					<dd>
						<LocalTime at={signal.since}>
							{formatRelative(signal.since, now)}
						</LocalTime>
					</dd>
				</dl>
				{signal.kind === "nothing" ? (
					<>
						<Separator />
						<p className="text-muted-foreground text-sm">
							Every run finished. Check that the flow still gets what it reads.
						</p>
					</>
				) : null}
			</div>
			{signal.kind === "failing" ? <AskWhy runId={signal.runId} /> : null}
		</section>
	);
}

/** An agent reads the failed run and says what went wrong. It changes nothing. */
function AskWhy({ runId }: { runId: string }) {
	const agent = useAgentAsk(runId);
	if (agent.missing) return null;
	return (
		<div className="flex flex-col gap-3 rounded-xl border bg-muted/40 p-4">
			<p className="text-muted-foreground text-sm">
				An agent reads the run and tells you what went wrong. It changes
				nothing.
			</p>
			<div>
				<AskAgentButton agent={agent} />
			</div>
			<AgentAnswer agent={agent} failed />
		</div>
	);
}
