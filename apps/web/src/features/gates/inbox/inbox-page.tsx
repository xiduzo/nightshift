import { gateParts, gateRun, waitedText } from "@nightshift/client";
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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	CircleAlertIcon,
	FolderIcon,
	HandIcon,
	InboxIcon,
	MoonIcon,
	SunriseIcon,
} from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { toast } from "sonner";
import { projectQueries } from "@/features/projects";
import { runMutations, runQueries } from "@/features/runs/queries";
import type { OpenGate, RunSummary } from "@/shared/api";
import { formatCountdown, formatTime, useNow } from "@/shared/format";
import { SiteHeader } from "@/shared/page";
import { useOpenGates } from "../use-open-gates";
import { GateDetail } from "./gate-detail";
import { groupByProject } from "./group-gates";

/**
 * The Needs-you inbox, laid out like the Agents page: open Gates on the left,
 * grouped by project and oldest first, and the selected Gate on the right.
 * It holds the Gates of every Space you are in; each project group shows
 * its Space. Sleeping runs (of the Space you work in) sit below the Gates.
 * Each pane scrolls on its own.
 */
export function InboxPage({
	gateId,
	onSelect,
}: {
	/** The step id of the Gate to show. The oldest one when unset or gone. */
	gateId: string | undefined;
	onSelect: (gateId: string) => void;
}) {
	const gates = useOpenGates();
	const now = useNow(30_000);
	const runs = useQuery(runQueries.everyRunForInbox());
	const projects = useQuery(projectQueries.list());
	const projectNames = new Map(projects.data?.map((p) => [p.id, p.name]));
	const sleeping = (runs.data ?? [])
		.filter((run) => run.status === "sleeping")
		.sort((a, b) => (a.wakeAt ?? 0) - (b.wakeAt ?? 0));

	const open = gates.data ?? [];
	const selected = open.find((g) => g.stepId === gateId) ?? open[0];
	const byProject = groupByProject(open);

	return (
		<>
			<SiteHeader crumbs={[{ label: "Inbox" }]} />
			<div className="flex h-[calc(100svh-3.5rem)] min-h-0">
				<nav
					aria-label="Inbox"
					className="flex w-72 shrink-0 flex-col gap-5 overflow-y-auto border-r p-4"
				>
					<div className="flex items-center justify-between gap-2 px-2">
						<div className="min-w-0">
							<h2 className="font-medium text-sm">Waiting for you</h2>
							<p className="text-muted-foreground text-xs">
								Each run goes on when you answer.
							</p>
						</div>
						{open.length > 0 ? (
							<Badge
								variant="outline"
								className="border-status-waiting/40 bg-status-waiting/10 text-status-waiting tabular-nums"
							>
								{open.length}
							</Badge>
						) : null}
					</div>
					{gates.isLoading ? (
						<ListSkeleton />
					) : open.length === 0 ? (
						<p className="px-2 text-muted-foreground text-xs">
							No open Gates right now.
						</p>
					) : (
						byProject.map(([projectId, list], index) => (
							<Fragment key={projectId}>
								{index > 0 ? <Separator /> : null}
								<NavGroup
									title={list[0]?.projectName ?? "Project"}
									hint={`${list.length} ${list.length === 1 ? "Gate waits" : "Gates wait"}`}
									aside={
										<Badge variant="outline" className="max-w-24 truncate">
											{list[0]?.spaceName}
										</Badge>
									}
								>
									{list.map((gate) => (
										<GateNavItem
											key={gate.stepId}
											gate={gate}
											now={now}
											selected={gate.stepId === selected?.stepId}
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
					) : selected ? (
						<GateDetail key={selected.stepId} gate={selected} now={now} />
					) : (
						<Empty className="h-full">
							<EmptyHeader>
								<EmptyMedia variant="icon">
									<InboxIcon />
								</EmptyMedia>
								<EmptyTitle>Nothing waits for you</EmptyTitle>
								<EmptyDescription>
									When a run in one of your Spaces reaches a Gate node, its
									question shows up here. Add one to a flow to ask before a step
									that matters.
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
	title: string;
	hint: string;
	aside?: ReactNode;
	children: ReactNode;
}) {
	return (
		<section className="flex flex-col gap-1">
			<div className="flex items-center justify-between gap-2 px-2">
				<div className="min-w-0">
					<h3 className="truncate font-medium text-sm">{title}</h3>
					<p className="text-muted-foreground text-xs">{hint}</p>
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
	const { flow, detail } = gateRun(gate);
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
			<ItemMedia variant="icon" className="self-start text-status-waiting">
				<HandIcon />
			</ItemMedia>
			<ItemContent className="min-w-0">
				<ItemTitle className="w-full">
					<span className="line-clamp-2">{headline}</span>
				</ItemTitle>
				<ItemDescription className="truncate text-xs">
					<span className="font-medium">{flow}</span>
					{detail ? ` · ${detail}` : null} ·{" "}
					<span className="text-status-waiting tabular-nums">
						{waitedText(now - gate.openedAt)}
					</span>
				</ItemDescription>
			</ItemContent>
		</Item>
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
	const now = useNow(1000);
	const queryClient = useQueryClient();
	const wake = useMutation(
		runMutations.resume({
			onSuccess: () =>
				queryClient.invalidateQueries({ queryKey: runQueries.all() }),
			onError: (error) => toast.error(`Could not wake: ${error.message}`),
		}),
	);

	return (
		<NavGroup
			title="Sleeping"
			hint="Each one goes on by itself"
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
											wakes {formatTime(run.wakeAt)}{" "}
											<span className="font-mono tabular-nums">
												({formatCountdown(run.wakeAt - now)})
											</span>
										</span>
									</>
								) : null}
							</ItemDescription>
						</ItemContent>
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
