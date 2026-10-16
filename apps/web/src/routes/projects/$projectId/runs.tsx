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
import { createFileRoute, Link } from "@tanstack/react-router";
import { HourglassIcon, MoonIcon, ZapIcon } from "lucide-react";
import { useState } from "react";

import { QuickRunDialog } from "@/components/new-run-form";
import { ProjectPage } from "@/components/project-page";
import { RunList } from "@/components/run-list";
import { useOpenGates } from "@/hooks/use-open-gates";
import { useProjectRuns } from "@/hooks/use-project-runs";
import { formatDateTime, formatTime } from "@/lib/format";

export const Route = createFileRoute("/projects/$projectId/runs")({
	component: ProjectRunsComponent,
});

function ProjectRunsComponent() {
	const { projectId } = Route.useParams();
	const runs = useProjectRuns(projectId);
	const gates = useOpenGates();
	const [quickRun, setQuickRun] = useState(false);
	const waiting =
		gates.data?.filter((gate) => gate.projectId === projectId).length ?? 0;
	const sleeping = runs.data?.filter((run) => run.status === "sleeping") ?? [];
	// The one that wakes first.
	const nextWake = sleeping
		.flatMap((run) => (run.wakeAt ? [run.wakeAt] : []))
		.sort((a, b) => a - b)[0];

	return (
		<ProjectPage
			projectId={projectId}
			section="Runs"
			actions={() => (
				<Button size="sm" onClick={() => setQuickRun(true)}>
					<ZapIcon data-icon="inline-start" />
					Quick run
				</Button>
			)}
		>
			{(project) => (
				<>
					<Card className="gap-0 pb-0">
						<CardHeader className="border-b pb-4 [.border-b]:pb-4">
							<CardTitle>
								<h1 id="runs-heading">Runs</h1>
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
					<QuickRunDialog
						projectId={project.id}
						open={quickRun}
						onOpenChange={setQuickRun}
					/>
				</>
			)}
		</ProjectPage>
	);
}
