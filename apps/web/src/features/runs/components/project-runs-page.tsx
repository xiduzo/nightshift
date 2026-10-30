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

/** The runs the list loads at first, and how many more each "Show older runs" adds. */
const RUNS_PER_PAGE = 15;

export function ProjectRunsPage({ projectId }: { projectId: string }) {
	const runs = useProjectRuns(projectId, RUNS_PER_PAGE);
	const gates = useOpenGates();
	const [quickRun, setQuickRun] = useState(false);
	const waiting =
		gates.data?.filter((gate) => gate.projectId === projectId).length ?? 0;

	return (
		<ProjectPage projectId={projectId} section="Runs">
			{(project) => {
				// Counted over every run of the project, not only the loaded ones.
				const sleeping = project.runs?.statuses.sleeping ?? 0;
				const nextWake = project.runs?.nextWakeAt ?? null;
				return (
					<section
						aria-labelledby="runs-heading"
						className="flex flex-col gap-4"
					>
						<PageHeading
							id="runs-heading"
							title="Runs"
							description="Open a run to follow its steps."
							actions={
								<>
									{sleeping > 0 ? (
										<Badge
											variant="outline"
											className="border-status-sleeping/40 bg-status-sleeping/10 text-status-sleeping"
										>
											<MoonIcon aria-hidden="true" />
											{sleeping} sleeping
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
									runs={runs.runs}
									isLoading={runs.isLoading}
									more={
										runs.hasNextPage
											? {
													load: () => void runs.fetchNextPage(),
													loading: runs.isFetchingNextPage,
												}
											: undefined
									}
									emptyDescription="Your runs show here. Start a quick run, or run a flow from Flows."
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
				);
			}}
		</ProjectPage>
	);
}
