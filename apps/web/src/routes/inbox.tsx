import { Button } from "@nightshift/ui/components/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@nightshift/ui/components/empty";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRightIcon, HandIcon, InboxIcon } from "lucide-react";

import { GateAnswer } from "@/components/gate/gate-answer";
import { useNow } from "@/hooks/use-now";
import { useOpenGates } from "@/hooks/use-open-gates";
import type { OpenGate } from "@/lib/api-types";
import { formatDateTime, formatWaited } from "@/lib/format";

export const Route = createFileRoute("/inbox")({
	// Polls from the browser; nothing to render on the server.
	ssr: false,
	component: InboxComponent,
});

function InboxComponent() {
	const gates = useOpenGates();
	const now = useNow(30_000);
	const count = gates.data?.length ?? 0;

	return (
		<main className="min-h-0 overflow-y-auto">
			<div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6">
				<header className="flex flex-col gap-0.5">
					<h1 className="flex items-center gap-2 font-medium text-base">
						Needs you
						{count > 0 ? (
							<span className="text-muted-foreground text-sm tabular-nums">
								{count}
							</span>
						) : null}
					</h1>
					<p className="text-muted-foreground text-xs">
						Runs that wait at a Gate for your answer, oldest first. Each one
						goes on as soon as you pick a choice.
					</p>
				</header>

				{gates.isLoading ? (
					<div className="flex flex-col gap-3">
						<Skeleton className="h-48 w-full" />
						<Skeleton className="h-48 w-full" />
					</div>
				) : gates.error && !gates.data ? (
					<Empty className="border">
						<EmptyHeader>
							<EmptyTitle>The inbox did not load</EmptyTitle>
							<EmptyDescription>{gates.error.message}</EmptyDescription>
						</EmptyHeader>
						<EmptyContent>
							<Button variant="outline" onClick={() => void gates.refetch()}>
								Try again
							</Button>
						</EmptyContent>
					</Empty>
				) : count === 0 ? (
					<Empty className="border">
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<InboxIcon />
							</EmptyMedia>
							<EmptyTitle>Nothing needs you</EmptyTitle>
							<EmptyDescription>
								When a run reaches a Gate node, its question shows up here. Add
								one to a flow to ask before a step that matters.
							</EmptyDescription>
						</EmptyHeader>
					</Empty>
				) : (
					<ol className="flex flex-col gap-3" aria-label="Open gates">
						{gates.data?.map((gate) => (
							<li key={gate.stepId}>
								<GateCard gate={gate} now={now} />
							</li>
						))}
					</ol>
				)}
			</div>
		</main>
	);
}

function GateCard({ gate, now }: { gate: OpenGate; now: number }) {
	const headingId = `gate-${gate.stepId}`;
	return (
		<article
			aria-labelledby={headingId}
			className="flex flex-col gap-3 border border-l-[3px] border-l-status-waiting bg-card p-3"
		>
			<header className="flex flex-col gap-1">
				<nav
					aria-label="Where"
					className="flex min-w-0 items-center gap-1 text-muted-foreground text-xs"
				>
					<Link
						to="/projects/$projectId"
						params={{ projectId: gate.projectId }}
						className="truncate outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
					>
						{gate.projectName}
					</Link>
					<ChevronRightIcon className="size-3 shrink-0" aria-hidden="true" />
					<span className="flex shrink-0 items-center gap-1 font-mono">
						<HandIcon className="size-3" aria-hidden="true" />
						{gate.nodeId}
					</span>
					<span className="ml-auto shrink-0 pl-2">
						waiting{" "}
						<time
							dateTime={new Date(gate.openedAt).toISOString()}
							title={`Opened ${formatDateTime(gate.openedAt)}`}
						>
							{formatWaited(now - gate.openedAt)}
						</time>
					</span>
				</nav>
				<h2 id={headingId} className="min-w-0 font-medium text-sm">
					<Link
						to="/runs/$runId"
						params={{ runId: gate.runId }}
						className="line-clamp-2 break-words underline-offset-2 outline-none hover:underline focus-visible:ring-1 focus-visible:ring-ring"
					>
						{gate.runTitle}
					</Link>
				</h2>
			</header>
			<p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
				{gate.question}
			</p>
			<GateAnswer
				runId={gate.runId}
				stepId={gate.stepId}
				nodeId={gate.nodeId}
				choices={gate.choices}
				runTitle={gate.runTitle}
			/>
		</article>
	);
}
