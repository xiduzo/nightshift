import { Badge } from "@nightshift/ui/components/badge";
import { Card, CardContent, CardHeader } from "@nightshift/ui/components/card";
import { Separator } from "@nightshift/ui/components/separator";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { Link } from "@tanstack/react-router";
import { ChevronRightIcon, HandIcon, HourglassIcon } from "lucide-react";

import { GateAnswer } from "@/components/gate/gate-answer";
import { GateQuestion } from "@/components/gate/gate-question";
import type { OpenGate } from "@/lib/api-types";
import { formatDateTime, formatWaited } from "@/lib/format";

/**
 * One open Gate in the inbox: where it waits, its question and context, and
 * the answer form. Amber, because a person is needed.
 */
export function GateCard({ gate, now }: { gate: OpenGate; now: number }) {
	const headingId = `gate-${gate.stepId}`;
	return (
		<Card
			role="article"
			aria-labelledby={headingId}
			className="gap-0 py-0 ring-status-waiting/35 [--card-spacing:--spacing(4)] sm:[--card-spacing:--spacing(6)]"
		>
			<CardHeader className="gap-2 border-b border-b-status-waiting/20 bg-status-waiting/5 py-3 [.border-b]:pb-3">
				<div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 text-muted-foreground text-xs">
					<nav aria-label="Where" className="flex min-w-0 items-center gap-1">
						<Link
							to="/projects/$projectId"
							params={{ projectId: gate.projectId }}
							className="shrink-0 underline-offset-3 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
						>
							{gate.projectName}
						</Link>
						<ChevronRightIcon className="size-3 shrink-0" aria-hidden="true" />
						<Link
							to="/runs/$runId"
							params={{ runId: gate.runId }}
							className="min-w-0 truncate font-medium text-foreground underline-offset-3 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
						>
							{gate.runTitle}
						</Link>
					</nav>
					<Badge variant="outline" className="font-mono text-muted-foreground">
						<HandIcon aria-hidden="true" />
						{gate.nodeId}
					</Badge>
					<Badge
						variant="outline"
						className="ml-auto border-status-waiting/40 bg-status-waiting/10 text-status-waiting"
					>
						<HourglassIcon aria-hidden="true" />
						waiting{" "}
						<time
							dateTime={new Date(gate.openedAt).toISOString()}
							title={`Opened ${formatDateTime(gate.openedAt)}`}
							className="tabular-nums"
						>
							{formatWaited(now - gate.openedAt)}
						</time>
					</Badge>
				</div>
			</CardHeader>
			<CardContent className="flex flex-col gap-5 py-5">
				<GateQuestion question={gate.question} headingId={headingId} />
				<Separator />
				<GateAnswer
					runId={gate.runId}
					stepId={gate.stepId}
					nodeId={gate.nodeId}
					choices={gate.choices}
					runTitle={gate.runTitle}
				/>
			</CardContent>
		</Card>
	);
}

/** The shape of a gate card while the inbox loads. */
export function GateCardSkeleton() {
	return (
		<Card className="gap-0 py-0" aria-hidden="true">
			<CardHeader className="border-b py-3 [.border-b]:pb-3">
				<div className="flex items-center gap-2">
					<Skeleton className="h-4 w-20" />
					<Skeleton className="h-4 w-48" />
					<Skeleton className="ml-auto h-5 w-24 rounded-full" />
				</div>
			</CardHeader>
			<CardContent className="flex flex-col gap-5 py-5">
				<Skeleton className="h-5 w-3/4" />
				<Skeleton className="h-4 w-full" />
				<Skeleton className="h-16 w-full" />
				<div className="grid gap-2 sm:grid-cols-2">
					<Skeleton className="h-11" />
					<Skeleton className="h-11" />
				</div>
			</CardContent>
		</Card>
	);
}
