import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@nightshift/ui/components/card";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@nightshift/ui/components/empty";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	ArrowLeftIcon,
	FolderXIcon,
	HourglassIcon,
	MoonIcon,
	ZapIcon,
} from "lucide-react";
import { useState } from "react";

import { FlowList } from "@/components/flow-list";
import { QuickRunDialog } from "@/components/new-run-form";
import { RunList } from "@/components/run-list";
import { ScheduleList } from "@/components/schedule/schedule-list";
import { SiteHeader } from "@/components/site-header";
import { useOpenGates } from "@/hooks/use-open-gates";
import { formatDateTime, formatTime } from "@/lib/format";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/projects/$projectId/")({
	component: ProjectComponent,
});

function ProjectComponent() {
	const { projectId } = Route.useParams();
	const projects = useQuery(orpc.projects.list.queryOptions());
	const runs = useQuery({
		...orpc.runs.list.queryOptions({ input: { projectId } }),
		// Live while a run is on its way, so one that reaches a Gate shows as waiting.
		refetchInterval: (query) =>
			query.state.data?.some(
				(run) =>
					run.status === "running" ||
					run.status === "waiting" ||
					run.status === "sleeping",
			)
				? 5000
				: false,
		meta: { quietRefetchErrors: true },
	});
	const project = projects.data?.find((p) => p.id === projectId);
	const gates = useOpenGates();
	const [quickRun, setQuickRun] = useState(false);
	const waiting =
		gates.data?.filter((gate) => gate.projectId === projectId).length ?? 0;
	const sleeping = runs.data?.filter((run) => run.status === "sleeping") ?? [];
	// The one that wakes first.
	const nextWake = sleeping
		.flatMap((run) => (run.wakeAt ? [run.wakeAt] : []))
		.sort((a, b) => a - b)[0];

	if (projects.isLoading) {
		return (
			<>
				<SiteHeader
					crumbs={[
						{ label: "Home", link: { to: "/" } },
						{ label: <Skeleton className="h-4 w-24" /> },
					]}
				/>
				<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
					<div className="flex flex-col gap-2">
						<Skeleton className="h-8 w-56" />
						<Skeleton className="h-4 w-80 max-w-full" />
					</div>
					<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
						<Skeleton className="h-40 w-full rounded-xl" />
						<Skeleton className="h-40 w-full rounded-xl" />
					</div>
				</div>
			</>
		);
	}

	if (!project) {
		return (
			<>
				<SiteHeader
					crumbs={[
						{ label: "Home", link: { to: "/" } },
						{ label: "Not found" },
					]}
				/>
				<div className="flex flex-1 flex-col p-4 md:p-6">
					<Empty className="border">
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<FolderXIcon aria-hidden="true" />
							</EmptyMedia>
							<EmptyTitle>Project not found</EmptyTitle>
							<EmptyDescription>It may have been removed.</EmptyDescription>
						</EmptyHeader>
						<EmptyContent>
							<Button
								variant="outline"
								nativeButton={false}
								render={<Link to="/" />}
							>
								<ArrowLeftIcon data-icon="inline-start" />
								Back to projects
							</Button>
						</EmptyContent>
					</Empty>
				</div>
			</>
		);
	}

	return (
		<>
			<SiteHeader
				crumbs={[{ label: "Home", link: { to: "/" } }, { label: project.name }]}
			>
				<Button size="sm" onClick={() => setQuickRun(true)}>
					<ZapIcon data-icon="inline-start" />
					Quick run
				</Button>
			</SiteHeader>
			<div className="flex flex-1 flex-col gap-8 p-4 md:p-6">
				<div className="flex min-w-0 flex-col gap-1">
					<h1 className="truncate font-semibold text-2xl tracking-tight">
						{project.name}
					</h1>
					<p
						className="truncate font-mono text-muted-foreground text-sm"
						title={project.repoPath}
					>
						{project.repoPath}
					</p>
				</div>

				<FlowList projectId={project.id} />

				<Card className="gap-0 pb-0">
					<CardHeader className="border-b pb-4 [.border-b]:pb-4">
						<CardTitle>
							<h2 id="runs-heading">Runs</h2>
						</CardTitle>
						<CardDescription>
							Each run works in its own worktree, on its own branch.
						</CardDescription>
						{sleeping.length > 0 || waiting > 0 ? (
							<CardAction className="flex flex-wrap items-center justify-end gap-2">
								{sleeping.length > 0 ? (
									<Badge
										variant="outline"
										className="border-status-sleeping/40 bg-status-sleeping/10 text-status-sleeping"
									>
										<MoonIcon aria-hidden="true" />
										{sleeping.length} sleeping
										{nextWake ? (
											<>
												, wakes{" "}
												<time
													dateTime={new Date(nextWake).toISOString()}
													title={formatDateTime(nextWake)}
												>
													{formatTime(nextWake)}
												</time>
											</>
										) : null}
									</Badge>
								) : null}
								{waiting > 0 ? (
									<Badge
										variant="outline"
										className="border-status-waiting/40 bg-status-waiting/10 text-status-waiting"
										render={<Link to="/inbox" />}
									>
										<HourglassIcon aria-hidden="true" />
										{waiting} waiting for you
									</Badge>
								) : null}
							</CardAction>
						) : null}
					</CardHeader>
					<CardContent className="px-0">
						<section aria-labelledby="runs-heading">
							<RunList
								runs={runs.data}
								isLoading={runs.isLoading}
								emptyDescription="Run a flow or start a quick run. Each run works in its own worktree."
								emptyAction={
									<Button onClick={() => setQuickRun(true)}>
										<ZapIcon data-icon="inline-start" />
										Quick run
									</Button>
								}
							/>
						</section>
					</CardContent>
				</Card>

				<ScheduleList projectId={project.id} />
			</div>
			<QuickRunDialog
				projectId={project.id}
				open={quickRun}
				onOpenChange={setQuickRun}
			/>
		</>
	);
}
