import {
	type AnswerDraft,
	gateOrder,
	gateParts,
	URGENCY_LABEL,
} from "@nightshift/client";
import {
	Alert,
	AlertAction,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@nightshift/ui/components/empty";
import { Kbd } from "@nightshift/ui/components/kbd";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { Spinner } from "@nightshift/ui/components/spinner";
import {
	ToggleGroup,
	ToggleGroupItem,
} from "@nightshift/ui/components/toggle-group";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import { cn } from "@nightshift/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import {
	CheckCheckIcon,
	ChevronLeftIcon,
	ChevronRightIcon,
	CircleAlertIcon,
	SkipForwardIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { outcomeLabel } from "@/features/flows";
import { projectQueries } from "@/features/projects";
import { runQueries } from "@/features/runs/queries";
import type { OpenGate } from "@/shared/api";
import { useNow } from "@/shared/format";
import { SiteHeader } from "@/shared/page";
import { gateQueries } from "../queries";
import { useOpenGates } from "../use-open-gates";
import { AnsweredList } from "./answered-list";
import { EMPTY_DRAFT, typing } from "./focus-answer";
import { FocusGate } from "./focus-gate";
import { SleepingRuns } from "./sleeping-runs";

/** What the inbox shows: the Gates that wait, the ones answered, or the sleeping runs. */
export type InboxView = "todo" | "answered" | "sleeping";

/** Where you are in the inbox. The route keeps it in the URL. */
export type InboxPlace = {
	view: InboxView;
	/** The step id of the open Gate in focus. The first one in the queue when unset or gone. */
	gate?: string;
	/** The answered Gate the Sheet shows (`answeredKey`). */
	answered?: string;
};

const SEGMENT: Record<OpenGate["urgency"], string> = {
	now: "bg-status-failed",
	today: "bg-status-waiting",
	later: "bg-muted-foreground/40",
};

/**
 * The inbox: one Gate at a time, in focus. The Gates of every Space you
 * are in form a queue (`gateOrder`): Now, then Today, then When you have
 * time. In each, the first deadline first, then the oldest. You answer
 * the Gate in focus, skip it to the end of the queue, or step back and
 * forth. Once you answer, the next one takes its place. A second view
 * lists what was answered, a third the runs that sleep.
 *
 * Keys: ← → (or K J) step, S skips. The answer takes 1–9, Enter and Esc.
 */
export function InboxPage({
	place,
	onPlace,
}: {
	place: InboxPlace;
	onPlace: (next: InboxPlace) => void;
}) {
	const gates = useOpenGates();
	const answered = useQuery(gateQueries.answered());
	const now = useNow(30_000);
	const runs = useQuery(runQueries.sleeping());
	const projects = useQuery(projectQueries.list());
	const projectNames = new Map(projects.data?.map((p) => [p.id, p.name]));
	const sleeping = (runs.data ?? [])
		.filter((run) => run.status === "sleeping")
		.sort((a, b) => (a.wakeAt ?? 0) - (b.wakeAt ?? 0));

	// What you skipped goes to the end of the queue, for as long as the page is open.
	const [skipped, setSkipped] = useState<string[]>([]);
	// What you picked and wrote, per Gate, while you step around.
	const [drafts, setDrafts] = useState<Record<string, AnswerDraft>>({});

	const ordered = gateOrder(gates.data ?? []);
	const queue = [
		...ordered.filter((g) => !skipped.includes(g.stepId)),
		...skipped
			.map((id) => ordered.find((g) => g.stepId === id))
			.filter((g): g is OpenGate => g !== undefined),
	];

	// The Gate in focus closed (you answered it): the next one takes its place.
	const lastIndex = useRef(0);
	const found = queue.findIndex((g) => g.stepId === place.gate);
	const index =
		found >= 0 ? found : Math.min(lastIndex.current, queue.length - 1);
	const gate = index >= 0 ? queue[index] : undefined;
	useEffect(() => {
		if (index >= 0) lastIndex.current = index;
	}, [index]);

	const view = place.view;
	const focus = (next: OpenGate | undefined) => {
		if (next) onPlace({ view: "todo", gate: next.stepId });
	};
	const step = (by: number) => focus(queue[index + by]);
	const skip = () => {
		if (!gate || queue.length < 2) return;
		const next = queue[index + 1] ?? queue[0];
		setSkipped((prev) => [
			...prev.filter((id) => id !== gate.stepId),
			gate.stepId,
		]);
		focus(next);
	};

	useEffect(() => {
		if (view !== "todo" || !gate) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.altKey || event.metaKey || event.ctrlKey || typing(event))
				return;
			if (event.key === "ArrowRight" || event.key === "j") step(1);
			else if (event.key === "ArrowLeft" || event.key === "k") step(-1);
			else if (event.key === "s") skip();
			else return;
			event.preventDefault();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	});

	const nowCount = queue.filter((g) => g.urgency === "now").length;
	const draft = (gate && drafts[gate.stepId]) ?? EMPTY_DRAFT;

	return (
		<>
			<SiteHeader crumbs={[{ label: "Inbox" }]}>
				<ToggleGroup
					aria-label="Inbox view"
					value={[view]}
					onValueChange={(next) => {
						const picked = next[0];
						if (
							picked === "todo" ||
							picked === "answered" ||
							picked === "sleeping"
						) {
							onPlace({ view: picked, gate: place.gate });
						}
					}}
					variant="outline"
					size="sm"
				>
					<ToggleGroupItem value="todo">
						To do
						{queue.length > 0 ? (
							<Badge variant="secondary" className="tabular-nums">
								{queue.length}
							</Badge>
						) : null}
					</ToggleGroupItem>
					<ToggleGroupItem value="answered">Answered</ToggleGroupItem>
					{sleeping.length > 0 || view === "sleeping" ? (
						<ToggleGroupItem value="sleeping">
							Sleeping
							<Badge
								variant="outline"
								className="border-status-sleeping/40 bg-status-sleeping/10 text-status-sleeping tabular-nums"
							>
								{sleeping.length}
							</Badge>
						</ToggleGroupItem>
					) : null}
				</ToggleGroup>
			</SiteHeader>
			<div className="h-[calc(100svh-3.5rem)] overflow-y-auto">
				{view === "answered" ? (
					answered.isLoading ? (
						<PageSkeleton />
					) : (
						<AnsweredList
							gates={answered.data ?? []}
							now={now}
							openKey={place.answered}
							onOpen={(key) => onPlace({ view: "answered", answered: key })}
						/>
					)
				) : view === "sleeping" ? (
					<SleepingRuns runs={sleeping} projectNames={projectNames} />
				) : gates.isLoading ? (
					<PageSkeleton />
				) : gates.error && !gates.data ? (
					<div className="mx-auto max-w-3xl p-8">
						<Alert variant="destructive">
							<CircleAlertIcon />
							<AlertTitle>The inbox did not load</AlertTitle>
							<AlertDescription>{gates.error.message}</AlertDescription>
							<AlertAction>
								<Button
									variant="outline"
									size="sm"
									disabled={gates.isFetching}
									onClick={() => void gates.refetch()}
								>
									{gates.isFetching ? (
										<Spinner data-icon="inline-start" />
									) : null}
									Try again
								</Button>
							</AlertAction>
						</Alert>
					</div>
				) : !gate ? (
					<Empty className="h-full">
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<CheckCheckIcon />
							</EmptyMedia>
							<EmptyTitle>Nothing waits for you</EmptyTitle>
							<EmptyDescription>
								When a run reaches a Gate, its question shows here. Add a Gate
								to a flow to ask you before an important step.
							</EmptyDescription>
						</EmptyHeader>
						<EmptyContent>
							<Button
								variant="outline"
								size="sm"
								onClick={() => onPlace({ view: "answered" })}
							>
								See what you answered
							</Button>
						</EmptyContent>
					</Empty>
				) : (
					<div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pt-6 md:px-8">
						<div className="flex flex-col gap-2">
							<div className="flex items-center justify-between gap-2 text-muted-foreground text-xs">
								<span className="tabular-nums">
									{index + 1} of {queue.length}
									{nowCount > 0 ? ` · ${nowCount} need you now` : ""}
								</span>
								<span className="hidden items-center gap-1 sm:flex">
									<Kbd>←</Kbd>
									<Kbd>→</Kbd> step · <Kbd>S</Kbd> skip · <Kbd>1</Kbd> pick ·{" "}
									<Kbd>⏎</Kbd> send
								</span>
							</div>
							{/* The queue at a glance: one segment per Gate, in the colour of its urgency. */}
							<div className="flex gap-1">
								{queue.map((g, i) => {
									const headline = gateParts(g.question).headline;
									const drafted = drafts[g.stepId]?.choice;
									return (
										<Tooltip key={g.stepId}>
											<TooltipTrigger
												render={
													<button
														type="button"
														aria-label={headline}
														aria-current={i === index ? "step" : undefined}
														onClick={() => focus(g)}
														className={cn(
															"h-1.5 flex-1 rounded-full outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-ring/50",
															SEGMENT[g.urgency],
															i === index
																? "opacity-100 ring-2 ring-ring/50"
																: skipped.includes(g.stepId)
																	? "opacity-20 hover:opacity-60"
																	: "opacity-40 hover:opacity-70",
														)}
													/>
												}
											/>
											<TooltipContent>
												{URGENCY_LABEL[g.urgency]} · {headline}
												{drafted ? ` · draft: ${outcomeLabel(drafted)}` : ""}
											</TooltipContent>
										</Tooltip>
									);
								})}
							</div>
						</div>

						<FocusGate
							key={gate.stepId}
							gate={gate}
							now={now}
							draft={draft}
							onDraft={(next) =>
								setDrafts((prev) => ({ ...prev, [gate.stepId]: next }))
							}
						/>

						<nav
							aria-label="Gates that wait"
							className="sticky bottom-4 z-10 flex justify-center pb-4"
						>
							<div className="flex items-center gap-1 rounded-full border bg-background/95 p-1 shadow-lg backdrop-blur">
								<Button
									variant="ghost"
									size="sm"
									disabled={index === 0}
									onClick={() => step(-1)}
								>
									<ChevronLeftIcon data-icon="inline-start" />
									Previous
								</Button>
								<Button
									variant="ghost"
									size="sm"
									disabled={queue.length < 2}
									onClick={skip}
								>
									<SkipForwardIcon data-icon="inline-start" />
									Skip for now
								</Button>
								<Button
									variant="ghost"
									size="sm"
									disabled={index === queue.length - 1}
									onClick={() => step(1)}
								>
									Next
									<ChevronRightIcon data-icon="inline-end" />
								</Button>
							</div>
						</nav>
					</div>
				)}
			</div>
		</>
	);
}

function PageSkeleton() {
	return (
		<div className="mx-auto flex max-w-3xl flex-col gap-6 p-8" aria-hidden>
			<Skeleton className="h-16 w-full" />
			<Skeleton className="h-10 w-2/3" />
			<Skeleton className="h-40 w-full" />
		</div>
	);
}
