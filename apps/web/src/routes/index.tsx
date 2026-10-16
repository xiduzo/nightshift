import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@nightshift/ui/components/alert-dialog";
import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@nightshift/ui/components/card";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@nightshift/ui/components/dropdown-menu";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@nightshift/ui/components/empty";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { Spinner } from "@nightshift/ui/components/spinner";
import { cn } from "@nightshift/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	ArrowRightIcon,
	CircleXIcon,
	FolderGitIcon,
	FolderOpenIcon,
	HourglassIcon,
	LoaderCircleIcon,
	MoonIcon,
	MoreHorizontalIcon,
	PlusIcon,
	Trash2Icon,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";

import { AddProjectDialog } from "@/components/add-project-form";
import { RunList } from "@/components/run-list";
import { SiteHeader } from "@/components/site-header";
import { useNow } from "@/hooks/use-now";
import { useOpenGates } from "@/hooks/use-open-gates";
import type { Project, RunSummary } from "@/lib/api-types";
import {
	formatCost,
	formatDateTime,
	formatRelative,
	formatTime,
} from "@/lib/format";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/")({
	component: HomeComponent,
});

const RECENT_RUNS = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

function HomeComponent() {
	const projects = useQuery(orpc.projects.list.queryOptions());
	const runs = useQuery(orpc.runs.list.queryOptions({ input: {} }));
	const [adding, setAdding] = useState(false);

	const recentRuns = runs.data
		?.slice()
		.sort((a, b) => b.createdAt - a.createdAt)
		.slice(0, RECENT_RUNS);

	return (
		<>
			<SiteHeader crumbs={[{ label: "Home" }]}>
				<Button size="sm" onClick={() => setAdding(true)}>
					<PlusIcon data-icon="inline-start" />
					Add project
				</Button>
			</SiteHeader>
			<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
				<div className="flex flex-col gap-1">
					<h1 className="font-semibold text-2xl tracking-tight">Tonight</h1>
					<p className="text-muted-foreground text-sm">
						What runs, what waits for you, and what it cost.
					</p>
				</div>

				<SectionCards runs={runs.data} isLoading={runs.isLoading} />

				<Card className="gap-0 pb-0">
					<CardHeader className="border-b pb-4 [.border-b]:pb-4">
						<CardTitle>
							<h2 id="runs-heading">Recent runs</h2>
						</CardTitle>
						<CardDescription>
							The last {RECENT_RUNS} runs over all projects, newest first.
						</CardDescription>
					</CardHeader>
					<CardContent className="px-0">
						<section aria-labelledby="runs-heading">
							<RunList
								runs={recentRuns}
								projects={projects.data}
								isLoading={runs.isLoading}
								emptyDescription="Open a project and start a run. It shows up here."
							/>
						</section>
					</CardContent>
				</Card>

				<section
					aria-labelledby="projects-heading"
					className="flex flex-col gap-4"
				>
					<div className="flex flex-col gap-1">
						<h2
							id="projects-heading"
							className="font-semibold text-lg tracking-tight"
						>
							Projects
						</h2>
						<p className="text-muted-foreground text-sm">
							Git repositories Night Shift works in.
						</p>
					</div>
					<ProjectList
						projects={projects.data}
						runs={runs.data}
						isLoading={projects.isLoading}
						onAdd={() => setAdding(true)}
					/>
				</section>
			</div>
			<AddProjectDialog open={adding} onOpenChange={setAdding} />
		</>
	);
}

/** The numbers on top, as in the shadcn `dashboard-01` block, from runs and open Gates. */
function SectionCards({
	runs,
	isLoading,
}: {
	runs: RunSummary[] | undefined;
	isLoading: boolean;
}) {
	const gates = useOpenGates();
	const now = useNow(60_000);
	const all = runs ?? [];
	const running = all.filter((run) => run.status === "running").length;
	const sleeping = all.filter((run) => run.status === "sleeping");
	// The one that wakes first.
	const nextWake = sleeping
		.flatMap((run) => (run.wakeAt ? [run.wakeAt] : []))
		.sort((a, b) => a - b)[0];
	const lastDay = all.filter((run) => run.createdAt >= now - DAY_MS);
	const spent = lastDay.reduce((sum, run) => sum + run.costUsd, 0);
	const spentAll = all.reduce((sum, run) => sum + run.costUsd, 0);
	const finished = lastDay.filter((run) => run.status === "finished").length;
	const failed = lastDay.filter((run) => run.status === "failed").length;
	const waiting = gates.data?.length ?? 0;

	return (
		<div className="grid grid-cols-2 gap-3 *:data-[slot=card]:bg-linear-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card md:grid-cols-2 md:gap-4 xl:grid-cols-4 dark:*:data-[slot=card]:bg-card">
			<StatCard
				label="Running now"
				value={isLoading ? null : running}
				badge={
					sleeping.length > 0 ? (
						<Badge
							variant="outline"
							className="border-status-sleeping/40 bg-status-sleeping/10 text-status-sleeping"
						>
							<MoonIcon aria-hidden="true" />
							{sleeping.length} sleeping
						</Badge>
					) : running > 0 ? (
						<Badge
							variant="outline"
							className="border-status-running/40 bg-status-running/10 text-status-running"
						>
							<LoaderCircleIcon
								aria-hidden="true"
								className="animate-spin motion-reduce:animate-none"
							/>
							Live
						</Badge>
					) : null
				}
				headline={
					running > 0
						? `${running === 1 ? "An agent is" : "Agents are"} at work`
						: "Nothing running"
				}
				footer={
					nextWake ? (
						<>
							Next wakes at{" "}
							<time
								dateTime={new Date(nextWake).toISOString()}
								title={formatDateTime(nextWake)}
							>
								{formatTime(nextWake)}
							</time>
						</>
					) : (
						"Start a flow from a project page"
					)
				}
			/>
			<StatCard
				label="Waiting for you"
				value={gates.isLoading ? null : gates.error ? "—" : waiting}
				className={
					waiting > 0
						? "ring-status-waiting/50 dark:ring-status-waiting/40"
						: undefined
				}
				badge={
					<Badge
						variant="outline"
						className={
							waiting > 0
								? "border-status-waiting/40 bg-status-waiting/10 text-status-waiting"
								: undefined
						}
						render={<Link to="/inbox" />}
					>
						Inbox
						<ArrowRightIcon data-icon="inline-end" aria-hidden="true" />
					</Badge>
				}
				headline={
					waiting > 0 ? (
						<span className="flex items-center gap-1.5 text-status-waiting">
							<HourglassIcon className="size-4" aria-hidden="true" />
							{waiting === 1 ? "A Gate needs" : "Gates need"} your answer
						</span>
					) : (
						"Nothing needs you"
					)
				}
				footer="Runs pause at a Gate for you"
			/>
			<StatCard
				label="Spent, last 24 h"
				value={isLoading ? null : formatCost(spent)}
				badge={
					<Badge variant="outline" className="tabular-nums">
						{lastDay.length} {lastDay.length === 1 ? "run" : "runs"}
					</Badge>
				}
				headline="Over all projects"
				footer={
					<>
						All time{" "}
						<span className="tabular-nums">{formatCost(spentAll)}</span>
					</>
				}
			/>
			<StatCard
				label="Runs, last 24 h"
				value={isLoading ? null : lastDay.length}
				badge={
					failed > 0 ? (
						<Badge variant="destructive" className="tabular-nums">
							<CircleXIcon aria-hidden="true" />
							{failed} failed
						</Badge>
					) : lastDay.length > 0 ? (
						<Badge
							variant="outline"
							className="border-status-finished/40 bg-status-finished/10 text-status-finished"
						>
							None failed
						</Badge>
					) : null
				}
				headline={
					<span className="tabular-nums">
						{finished} finished, {failed} failed
					</span>
				}
				footer={
					lastDay.length - finished - failed > 0
						? `${lastDay.length - finished - failed} stopped, running or waiting`
						: "Started in the last day"
				}
			/>
		</div>
	);
}

function StatCard({
	label,
	value,
	badge,
	headline,
	footer,
	className,
}: {
	label: string;
	/** Null while loading. */
	value: ReactNode | null;
	badge?: ReactNode;
	headline: ReactNode;
	footer: ReactNode;
	className?: string;
}) {
	return (
		<Card className={cn("@container/card", className)}>
			<CardHeader className="@max-[250px]/card:grid-cols-1!">
				<CardDescription>{label}</CardDescription>
				<CardTitle className="font-semibold @[250px]/card:text-3xl text-2xl tabular-nums">
					{value === null ? <Skeleton className="h-9 w-20" /> : value}
				</CardTitle>
				{badge ? (
					<CardAction className="@max-[250px]/card:hidden">{badge}</CardAction>
				) : null}
			</CardHeader>
			<CardFooter className="flex-col items-start gap-1.5 text-sm">
				<div className="line-clamp-1 font-medium">{headline}</div>
				<div className="line-clamp-1 @max-[250px]/card:hidden text-muted-foreground">
					{footer}
				</div>
			</CardFooter>
		</Card>
	);
}

function ProjectList({
	projects,
	runs,
	isLoading,
	onAdd,
}: {
	projects: Project[] | undefined;
	runs: RunSummary[] | undefined;
	isLoading: boolean;
	onAdd: () => void;
}) {
	const queryClient = useQueryClient();
	const [toRemove, setToRemove] = useState<Project | null>(null);
	const removeProject = useMutation(
		orpc.projects.remove.mutationOptions({
			onSuccess: () => {
				setToRemove(null);
				void queryClient.invalidateQueries({ queryKey: orpc.projects.key() });
				void queryClient.invalidateQueries({ queryKey: orpc.runs.key() });
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	if (isLoading) {
		return (
			<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
				<Skeleton className="h-32 w-full rounded-xl" />
				<Skeleton className="h-32 w-full rounded-xl" />
			</div>
		);
	}

	if (!projects || projects.length === 0) {
		return (
			<Empty className="border">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<FolderGitIcon aria-hidden="true" />
					</EmptyMedia>
					<EmptyTitle>No projects yet</EmptyTitle>
					<EmptyDescription>
						Add a git repository. Each run gets its own worktree in it.
					</EmptyDescription>
				</EmptyHeader>
				<EmptyContent>
					<Button onClick={onAdd}>
						<PlusIcon data-icon="inline-start" />
						Add project
					</Button>
				</EmptyContent>
			</Empty>
		);
	}

	return (
		<>
			<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
				{projects.map((project) => (
					<ProjectCard
						key={project.id}
						project={project}
						runs={runs?.filter((run) => run.projectId === project.id)}
						removing={removeProject.isPending}
						onRemove={() => setToRemove(project)}
					/>
				))}
			</div>
			<AlertDialog
				open={toRemove !== null}
				onOpenChange={(open) => {
					if (!open) setToRemove(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							Remove {toRemove?.name} from Night Shift?
						</AlertDialogTitle>
						<AlertDialogDescription>
							Night Shift forgets the project and its runs. The repository at{" "}
							<span className="font-mono">{toRemove?.repoPath}</span> stays as
							it is.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							disabled={removeProject.isPending}
							onClick={() => {
								if (toRemove) removeProject.mutate({ projectId: toRemove.id });
							}}
						>
							{removeProject.isPending ? (
								<Spinner data-icon="inline-start" />
							) : null}
							{removeProject.isPending ? "Removing…" : "Remove project"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}

function ProjectCard({
	project,
	runs,
	removing,
	onRemove,
}: {
	project: Project;
	/** This project's runs, when loaded. */
	runs: RunSummary[] | undefined;
	removing: boolean;
	onRemove: () => void;
}) {
	const last = runs?.reduce<RunSummary | undefined>(
		(latest, run) =>
			latest === undefined || run.createdAt > latest.createdAt ? run : latest,
		undefined,
	);
	const active =
		runs?.filter(
			(run) =>
				run.status === "running" ||
				run.status === "waiting" ||
				run.status === "sleeping",
		).length ?? 0;

	return (
		<Card
			size="sm"
			className="relative transition-colors hover:bg-muted/40 has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-ring/50"
		>
			<CardHeader>
				<CardTitle className="flex min-w-0 items-center gap-2">
					<FolderGitIcon
						className="size-4 shrink-0 text-muted-foreground"
						aria-hidden="true"
					/>
					{/* The link covers the card, so the card is one target. */}
					<Link
						to="/projects/$projectId"
						params={{ projectId: project.id }}
						className="truncate outline-none after:absolute after:inset-0"
					>
						{project.name}
					</Link>
				</CardTitle>
				<CardDescription
					className="truncate font-mono text-xs"
					title={project.repoPath}
				>
					{project.repoPath}
				</CardDescription>
				<CardAction className="relative z-10">
					<DropdownMenu>
						<DropdownMenuTrigger
							render={
								<Button
									variant="ghost"
									size="icon-sm"
									aria-label={`Actions for ${project.name}`}
									className="text-muted-foreground"
								/>
							}
						>
							<MoreHorizontalIcon />
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className="w-44">
							<DropdownMenuItem
								render={
									<Link
										to="/projects/$projectId"
										params={{ projectId: project.id }}
									/>
								}
							>
								<FolderOpenIcon aria-hidden="true" />
								Open project
							</DropdownMenuItem>
							<DropdownMenuSeparator />
							<DropdownMenuItem
								variant="destructive"
								disabled={removing}
								aria-label={`Remove ${project.name}`}
								onClick={onRemove}
							>
								<Trash2Icon aria-hidden="true" />
								Remove project
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</CardAction>
			</CardHeader>
			<CardFooter className="gap-2 text-muted-foreground text-xs">
				{runs === undefined ? (
					<Skeleton className="h-4 w-32" />
				) : last ? (
					<>
						<span className="tabular-nums">
							{runs.length} {runs.length === 1 ? "run" : "runs"}
						</span>
						<span aria-hidden="true">·</span>
						<span className="truncate">
							last{" "}
							<time
								dateTime={new Date(last.createdAt).toISOString()}
								title={formatDateTime(last.createdAt)}
							>
								{formatRelative(last.createdAt)}
							</time>
						</span>
						{active > 0 ? (
							<Badge
								variant="outline"
								className="ml-auto border-status-running/40 bg-status-running/10 text-status-running"
							>
								{active} active
							</Badge>
						) : null}
					</>
				) : (
					"No runs yet"
				)}
			</CardFooter>
		</Card>
	);
}
