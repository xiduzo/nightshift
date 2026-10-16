import {
	Alert,
	AlertAction,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import {
	Card,
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
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemSeparator,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { Spinner } from "@nightshift/ui/components/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	CircleAlertIcon,
	FolderIcon,
	InboxIcon,
	MoonIcon,
	SunriseIcon,
} from "lucide-react";
import { Fragment } from "react";
import { toast } from "sonner";

import { GateCard, GateCardSkeleton } from "@/components/gate/gate-card";
import { SiteHeader } from "@/components/site-header";
import { useNow } from "@/hooks/use-now";
import { useOpenGates } from "@/hooks/use-open-gates";
import type { Project, RunSummary } from "@/lib/api-types";
import { formatCountdown, formatDateTime, formatTime } from "@/lib/format";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/inbox")({
	// Polls from the browser; nothing to render on the server.
	ssr: false,
	component: InboxComponent,
});

function InboxComponent() {
	const gates = useOpenGates();
	const now = useNow(30_000);
	const count = gates.data?.length ?? 0;
	const runs = useQuery({
		...orpc.runs.list.queryOptions({ input: {} }),
		refetchInterval: 15_000,
		meta: { quietErrors: true },
	});
	const projects = useQuery(orpc.projects.list.queryOptions());
	const sleeping = (runs.data ?? [])
		.filter((run) => run.status === "sleeping")
		.sort((a, b) => (a.wakeAt ?? 0) - (b.wakeAt ?? 0));

	const summary = gates.isLoading
		? "Looking for open Gates…"
		: gates.error && !gates.data
			? "Runs that wait at a Gate for your answer."
			: count === 0
				? "No open Gates right now."
				: `${count} ${count === 1 ? "Gate waits" : "Gates wait"} for your answer, oldest first. Each run goes on as soon as you pick a choice.`;

	return (
		<>
			<SiteHeader crumbs={[{ label: "Inbox" }]} />
			<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
				<div className="flex w-full max-w-4xl flex-col gap-1">
					<h1 className="flex items-center gap-2 font-semibold text-2xl tracking-tight">
						Inbox
						{count > 0 ? (
							<Badge
								variant="outline"
								className="border-status-waiting/40 bg-status-waiting/10 text-status-waiting tabular-nums"
							>
								{count}
							</Badge>
						) : null}
					</h1>
					<p className="text-muted-foreground text-sm">{summary}</p>
				</div>

				<div className="flex w-full max-w-4xl flex-col gap-6">
					{gates.isLoading ? (
						<div className="flex flex-col gap-4">
							<GateCardSkeleton />
							<GateCardSkeleton />
						</div>
					) : gates.error && !gates.data ? (
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
					) : count === 0 ? (
						<Empty className="border border-dashed">
							<EmptyHeader>
								<EmptyMedia variant="icon">
									<InboxIcon />
								</EmptyMedia>
								<EmptyTitle>Nothing waits for you</EmptyTitle>
								<EmptyDescription>
									When a run reaches a Gate node, its question shows up here.
									Add one to a flow to ask before a step that matters.
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
					) : (
						<ol className="flex flex-col gap-4" aria-label="Open gates">
							{gates.data?.map((gate) => (
								<li key={gate.stepId}>
									<GateCard gate={gate} now={now} />
								</li>
							))}
						</ol>
					)}

					{sleeping.length > 0 ? (
						<SleepingRuns runs={sleeping} projects={projects.data} />
					) : null}
				</div>
			</div>
		</>
	);
}

/** Runs that wait on a usage limit or the network. They go on by themselves. */
function SleepingRuns({
	runs,
	projects,
}: {
	runs: RunSummary[];
	projects: Project[] | undefined;
}) {
	const now = useNow(1000);
	const queryClient = useQueryClient();
	const wake = useMutation(
		orpc.runs.resume.mutationOptions({
			onSuccess: () =>
				queryClient.invalidateQueries({ queryKey: orpc.runs.key() }),
			onError: (error) => toast.error(`Could not wake: ${error.message}`),
		}),
	);
	const projectNames = new Map(projects?.map((p) => [p.id, p.name]));

	return (
		<Card
			role="region"
			aria-labelledby="sleeping-heading"
			className="gap-0 py-0"
		>
			<CardHeader className="border-b py-4 [.border-b]:pb-4">
				<CardTitle className="text-sm">
					<h2 id="sleeping-heading" className="flex items-center gap-2">
						<MoonIcon
							className="size-4 text-status-sleeping"
							aria-hidden="true"
						/>
						Sleeping
						<Badge
							variant="outline"
							className="border-status-sleeping/40 bg-status-sleeping/10 text-status-sleeping tabular-nums"
						>
							{runs.length}
						</Badge>
					</h2>
				</CardTitle>
				<CardDescription className="text-xs">
					Runs that wait for a usage limit or the network. Each one continues
					its session on its own; wake it to try now.
				</CardDescription>
			</CardHeader>
			<CardContent className="px-0">
				<ItemGroup className="gap-0">
					{runs.map((run, index) => {
						const waking = wake.isPending && wake.variables?.runId === run.id;
						return (
							<Fragment key={run.id}>
								{index > 0 ? <ItemSeparator className="my-0" /> : null}
								<Item size="sm" className="rounded-none px-4 md:px-6">
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
										<ItemDescription className="text-xs">
											{projectNames.get(run.projectId) ?? "Project"}
											{run.wakeAt ? (
												<>
													{" · "}
													<span className="text-status-sleeping">
														wakes{" "}
														<time
															dateTime={new Date(run.wakeAt).toISOString()}
															title={formatDateTime(run.wakeAt)}
														>
															{formatTime(run.wakeAt)}
														</time>{" "}
														<span className="font-mono tabular-nums">
															({formatCountdown(run.wakeAt - now)})
														</span>
													</span>
												</>
											) : null}
										</ItemDescription>
									</ItemContent>
									<ItemActions>
										<Button
											variant="outline"
											size="sm"
											disabled={waking}
											onClick={() => wake.mutate({ runId: run.id })}
										>
											{waking ? (
												<Spinner data-icon="inline-start" />
											) : (
												<SunriseIcon data-icon="inline-start" />
											)}
											Wake now
										</Button>
									</ItemActions>
								</Item>
							</Fragment>
						);
					})}
				</ItemGroup>
			</CardContent>
		</Card>
	);
}
