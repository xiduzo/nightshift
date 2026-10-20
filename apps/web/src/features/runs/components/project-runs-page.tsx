import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import { Card, CardContent } from "@nightshift/ui/components/card";
import { Link } from "@tanstack/react-router";
import { HourglassIcon, MoonIcon, ZapIcon } from "lucide-react";
import { useState } from "react";
import { useOpenGates } from "@/features/gates";
import { ProjectPage } from "@/features/projects";
import { formatDateTime, formatTime } from "@/shared/format";
import { PageHeading } from "@/shared/page";
import { useProjectRuns } from "../hooks/use-project-runs";
import { QuickRunDialog } from "./new-run-form";
import { RunList } from "./run-list";

export function ProjectRunsPage({ projectId }: { projectId: string }) {
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
					<PageHeading
						id="runs-heading"
						title="Runs"
						description="Every flow and quick run you start. Open one to follow its steps."
						actions={
							<>
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
							</>
						}
					/>
					<Card className="py-0">
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
