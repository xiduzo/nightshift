import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import { Card, CardContent } from "@nightshift/ui/components/card";
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
		<ProjectPage projectId={projectId} section="Runs">
			{(project) => (
				<section aria-labelledby="runs-heading" className="flex flex-col gap-4">
					<div className="flex items-end gap-4">
						<div className="flex min-w-0 flex-1 flex-col gap-1">
							<h1
								id="runs-heading"
								className="font-semibold text-2xl tracking-tight"
							>
								Runs
							</h1>
							<p className="text-muted-foreground text-sm">
								Every flow and quick run you start. Open one to follow its
								steps.
							</p>
						</div>
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
						<Button
							variant="outline"
							size="sm"
							onClick={() => setQuickRun(true)}
						>
							<ZapIcon data-icon="inline-start" />
							Quick run
						</Button>
					</div>
					<Card>
						<CardContent className="px-0">
							<RunList
								runs={runs.data}
								isLoading={runs.isLoading}
								emptyDescription="Start a quick run, or run a flow from Flows. Your runs show up here."
								emptyAction={
									<Button onClick={() => setQuickRun(true)}>
										<ZapIcon data-icon="inline-start" />
										Quick run
									</Button>
								}
							/>
						</CardContent>
					</Card>
					<QuickRunDialog
						projectId={project.id}
						open={quickRun}
						onOpenChange={setQuickRun}
					/>
				</section>
			)}
		</ProjectPage>
	);
}
