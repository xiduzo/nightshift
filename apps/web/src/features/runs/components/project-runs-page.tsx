import { Button } from "@nightshift/ui/components/button";
import { Card, CardContent } from "@nightshift/ui/components/card";
import { ZapIcon } from "lucide-react";
import { useState } from "react";
import { ProjectPage } from "@/features/projects";
import { PageHeading } from "@/shared/page";
import { useProjectRuns } from "../hooks/use-project-runs";
import { QuickRunDialog } from "./new-run-form";
import { RunList } from "./run-list";

/** The runs the list loads at first, and how many more each "Show older runs" adds. */
const RUNS_PER_PAGE = 15;

export function ProjectRunsPage({ projectId }: { projectId: string }) {
	const runs = useProjectRuns(projectId, RUNS_PER_PAGE);
	const [quickRun, setQuickRun] = useState(false);

	return (
		<ProjectPage projectId={projectId} section="Runs">
			{(project) => {
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
								<Button
									variant="outline"
									size="sm"
									onClick={() => setQuickRun(true)}
								>
									<ZapIcon data-icon="inline-start" />
									Quick run
								</Button>
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
