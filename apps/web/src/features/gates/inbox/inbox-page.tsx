import {
	deadlineWhen,
	gateParts,
	runActions,
	useRunActed,
	waitedText,
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
	ButtonGroup,
	ButtonGroupText,
} from "@nightshift/ui/components/button-group";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@nightshift/ui/components/empty";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { Separator } from "@nightshift/ui/components/separator";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { Spinner } from "@nightshift/ui/components/spinner";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	ChevronDownIcon,
	ChevronUpIcon,
	CircleAlertIcon,
	FolderIcon,
	InboxIcon,
	MoonIcon,
	SunriseIcon,
} from "lucide-react";
import { Fragment, type ReactNode, useEffect, useRef } from "react";
import { toast } from "sonner";
import { usePushUrgencies } from "@/features/notifications";
import { projectQueries } from "@/features/projects";
import { runMutations, runQueries } from "@/features/runs/queries";
import type { OpenGate, RunSummary } from "@/shared/api";
import { orpc } from "@/shared/api";
import { formatCountdown, formatTime, useNow } from "@/shared/format";
import { InlineMarkdown } from "@/shared/markdown";
import { SiteHeader } from "@/shared/page";
import { LocalTime } from "@/shared/time";
import { URGENCY_LABEL, UrgencyMarker } from "@/shared/urgency";
import { gateQueries } from "../queries";
import { useOpenGates } from "../use-open-gates";
import { AnsweredGateDetail, AnsweredGateNavItem } from "./answered-gate";
import { GateDetail } from "./gate-detail";
import { ladderOf, reachText, rowLine } from "./ladder";

/**
 * The inbox: a list and a detail, as a mail app has. The list is a
 * ladder: the open Gates of every Space you are in, grouped Now, Today and
 * When you have time, the oldest first in each. Then the sleeping runs,
 * then the Gates that closed in the last 90 days. The selected item shows
 * on the right as a handover, with your answer beside it. Each pane
 * scrolls on its own.
 */
export function InboxPage({
	gateId,
	onSelect,
}: {
	/** The step id of the Gate to show: an open one, else an answered one. The oldest open one when unset or gone. */
	gateId: string | undefined;
	onSelect: (gate: string) => void;
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

	const pushUrgencies = usePushUrgencies();

	const closed = answered.data ?? [];
	const ladder = ladderOf(gates.data ?? []);
	const open = ladder.flatMap((group) => group.gates);

	const selectedOpen =
		open.find((g) => g.stepId === gateId) ??
		(closed.some((g) => g.stepId === gateId) ? undefined : open[0]);
	const selectedClosed = selectedOpen
		? undefined
		: (closed.find((g) => g.stepId === gateId) ?? closed[0]);
	const position = selectedOpen ? open.indexOf(selectedOpen) : -1;

	// The Gate you look at closed (you answered it): go on to the next one that waits.
	const wasOpen = useRef(new Set<string>());
	useEffect(() => {
		const openIds = new Set(open.map((g) => g.stepId));
		const next = open[0];
		if (gateId && wasOpen.current.has(gateId) && !openIds.has(gateId) && next) {
			onSelect(next.stepId);
		}
		wasOpen.current = openIds;
	}, [open, gateId, onSelect]);

	return (
		<>
			<SiteHeader crumbs={[{ label: "Inbox" }]}>
				{position >= 0 ? (
					<ButtonGroup aria-label="Gates that wait">
						<ButtonGroupText className="text-muted-foreground text-xs tabular-nums">
							{position + 1} of {open.length} waiting
						</ButtonGroupText>
						<Button
							variant="outline"
							size="icon-sm"
							aria-label="Previous Gate"
							disabled={position === 0}
							onClick={() => {
								const prev = open[position - 1];
								if (prev) onSelect(prev.stepId);
							}}
						>
							<ChevronUpIcon />
						</Button>
						<Button
							variant="outline"
							size="icon-sm"
							aria-label="Next Gate"
							disabled={position === open.length - 1}
							onClick={() => {
								const next = open[position + 1];
								if (next) onSelect(next.stepId);
							}}
						>
							<ChevronDownIcon />
						</Button>
					</ButtonGroup>
				) : null}
			</SiteHeader>
			<div className="flex h-[calc(100svh-3.5rem)] min-h-0">
				<nav
					aria-label="Inbox"
					className="flex min-h-0 w-80 shrink-0 flex-col gap-5 overflow-y-auto border-r p-4"
				>
					{gates.isLoading ? (
						<ListSkeleton />
					) : open.length === 0 ? (
						<p className="px-2 text-muted-foreground text-xs">
							Nothing waits for you. A run asks you here when it needs your
							decision.
						</p>
					) : (
						ladder.map(({ urgency, gates: list }, index) => (
							<Fragment key={urgency}>
								{index > 0 ? <Separator /> : null}
								<NavGroup
									title={
										<span className="flex items-center gap-1.5">
											<UrgencyMarker urgency={urgency} />
											{URGENCY_LABEL[urgency]}
										</span>
									}
									hint={reachText(urgency, pushUrgencies)}
									aside={
										<Badge variant="outline" className="tabular-nums">
											{list.length}
										</Badge>
									}
								>
									{list.map((gate) => (
										<GateNavItem
											key={gate.stepId}
											gate={gate}
											now={now}
											selected={gate.stepId === selectedOpen?.stepId}
											onClick={() => onSelect(gate.stepId)}
										/>
									))}
								</NavGroup>
							</Fragment>
						))
					)}
					{sleeping.length > 0 ? (
						<>
							<Separator />
							<SleepingGroup runs={sleeping} projectNames={projectNames} />
						</>
					) : null}
					{closed.length > 0 ? (
						<>
							<Separator />
							<NavGroup title="Answered" hint="Kept for 90 days">
								{closed.map((gate) => (
									<AnsweredGateNavItem
										key={`${gate.stepId} ${gate.openedAt}`}
										gate={gate}
										now={now}
										selected={
											gate.stepId === selectedClosed?.stepId &&
											gate.openedAt === selectedClosed.openedAt
										}
										onClick={() => onSelect(gate.stepId)}
									/>
								))}
							</NavGroup>
						</>
					) : null}
				</nav>
				<div className="min-w-0 flex-1 overflow-y-auto">
					{gates.isLoading ? (
						<DetailSkeleton />
					) : gates.error && !gates.data ? (
						<div className="p-8">
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
					) : selectedOpen ? (
						<GateDetail
							key={selectedOpen.stepId}
							gate={selectedOpen}
							now={now}
						/>
					) : selectedClosed ? (
						<AnsweredGateDetail
							key={`${selectedClosed.stepId} ${selectedClosed.openedAt}`}
							gate={selectedClosed}
						/>
					) : (
						<Empty className="h-full">
							<EmptyHeader>
								<EmptyMedia variant="icon">
									<InboxIcon />
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
									nativeButton={false}
									render={<Link to="/" />}
								>
									<FolderIcon data-icon="inline-start" />
									Go to projects
								</Button>
							</EmptyContent>
						</Empty>
					)}
				</div>
			</div>
		</>
	);
}

function NavGroup({
	title,
	hint,
	aside,
	children,
}: {
	title: ReactNode;
	hint: string | null;
	aside?: ReactNode;
	children: ReactNode;
}) {
	return (
		<section className="flex flex-col gap-1">
			<div className="flex items-center justify-between gap-2 px-2">
				<div className="min-w-0">
					<h3 className="truncate font-medium text-sm">{title}</h3>
					{hint ? (
						<p className="text-muted-foreground text-xs">{hint}</p>
					) : null}
				</div>
				{aside}
			</div>
			<ItemGroup className="gap-0.5">{children}</ItemGroup>
		</section>
	);
}

function GateNavItem({
	gate,
	now,
	selected,
	onClick,
}: {
	gate: OpenGate;
	now: number;
	selected: boolean;
	onClick: () => void;
}) {
	const { headline } = gateParts(gate.question);
	const line = rowLine(gate);
	return (
		<Item
			size="xs"
			variant={selected ? "muted" : "default"}
			render={
				<button
					type="button"
					className="text-left"
					aria-current={selected ? "page" : undefined}
				/>
			}
			onClick={onClick}
		>
			<ItemContent className="min-w-0">
				<ItemTitle className="w-full">
					<span className="line-clamp-2">
						<InlineMarkdown text={headline} links={false} />
					</span>
				</ItemTitle>
				{line ? (
					<ItemDescription className="line-clamp-1 text-xs">
						<InlineMarkdown text={line} links={false} />
					</ItemDescription>
				) : null}
				<ItemDescription className="truncate text-xs">
					{gate.projectName} ·{" "}
					{gate.deadline ? (
						<DueText at={gate.deadline.at} now={now} />
					) : (
						<span className="text-status-waiting tabular-nums">
							{waitedText(now - gate.openedAt)}
						</span>
					)}
				</ItemDescription>
			</ItemContent>
		</Item>
	);
}

/** "due 12:00", "due 07:00 tomorrow": when a Gate with a deadline needs its answer. */
function DueText({ at, now }: { at: number; now: number }) {
	const { time, day } = deadlineWhen(at, now);
	return (
		<LocalTime at={at} className="font-medium text-status-waiting tabular-nums">
			due {time}
			{day}
		</LocalTime>
	);
}

/** How long until a sleeping run wakes, again each second. Only this text updates, not the whole group. */
function WakeCountdown({ at }: { at: number }) {
	const now = useNow(1000);
	return (
		<span className="font-mono tabular-nums">
			({formatCountdown(at - now)})
		</span>
	);
}

/** Runs that wait on a usage limit or the network. They go on by themselves. */
function SleepingGroup({
	runs,
	projectNames,
}: {
	runs: RunSummary[];
	projectNames: Map<string, string>;
}) {
	const runActed = useRunActed({ orpc });
	const wake = useMutation(
		runMutations.resume({
			onSuccess: (_, { runId }) => runActed(runId),
			onError: (error) => toast.error(`Could not wake: ${error.message}`),
		}),
	);

	return (
		<NavGroup
			title="Sleeping"
			hint="Each one continues on its own"
			aside={
				<Badge
					variant="outline"
					className="border-status-sleeping/40 bg-status-sleeping/10 text-status-sleeping tabular-nums"
				>
					{runs.length}
				</Badge>
			}
		>
			{runs.map((run) => {
				const waking = wake.isPending && wake.variables?.runId === run.id;
				return (
					<Item key={run.id} size="xs">
						<ItemMedia variant="icon" className="text-status-sleeping">
							<MoonIcon />
						</ItemMedia>
						<ItemContent className="min-w-0">
							<ItemTitle className="w-full min-w-0">
								<Link
									to="/runs/$runId"
									params={{ runId: run.id }}
									className="truncate underline-offset-3 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
								>
									{run.title}
								</Link>
							</ItemTitle>
							<ItemDescription className="truncate text-xs">
								{projectNames.get(run.projectId) ?? "Project"}
								{run.wakeAt ? (
									<>
										{" · "}
										<span className="text-status-sleeping">
											wakes{" "}
											<LocalTime at={run.wakeAt}>
												{formatTime(run.wakeAt)}
											</LocalTime>{" "}
											<WakeCountdown at={run.wakeAt} />
										</span>
									</>
								) : null}
							</ItemDescription>
						</ItemContent>
						{/* Only the device that runs it wakes it. */}
						{runActions(run.status, run.walker.thisDevice, run.result)
							.resume ? (
							<ItemActions>
								<Tooltip>
									<TooltipTrigger
										render={
											<Button
												variant="ghost"
												size="icon-sm"
												aria-label={`Wake ${run.title} now`}
												disabled={waking}
												onClick={() => wake.mutate({ runId: run.id })}
											/>
										}
									>
										{waking ? <Spinner /> : <SunriseIcon />}
									</TooltipTrigger>
									<TooltipContent>Wake now</TooltipContent>
								</Tooltip>
							</ItemActions>
						) : null}
					</Item>
				);
			})}
		</NavGroup>
	);
}

function ListSkeleton() {
	return (
		<div className="flex flex-col gap-2 px-2 py-1" aria-hidden>
			<Skeleton className="h-10 w-full" />
			<Skeleton className="h-10 w-full" />
		</div>
	);
}

function DetailSkeleton() {
	return (
		<div className="mx-auto flex max-w-6xl flex-col gap-6 p-8" aria-hidden>
			<Skeleton className="h-12 w-2/3" />
			<div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
				<Skeleton className="h-64 w-full" />
				<Skeleton className="h-64 w-full" />
			</div>
		</div>
	);
}
