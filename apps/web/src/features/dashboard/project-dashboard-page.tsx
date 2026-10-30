import { Button } from "@nightshift/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { ZapIcon } from "lucide-react";
import { useState } from "react";
import {
	ProjectFolderLine,
	ProjectMenu,
	ProjectPage,
} from "@/features/projects";
import { QuickRunDialog } from "@/features/runs";
import { PageHeading } from "@/shared/page";
import { FlowCost } from "./flow-cost";
import { FlowHealth } from "./flow-health";
import { NightOutput } from "./night-output";
import { ProjectClones } from "./project-clones";
import { dashboardQueries } from "./queries";
import { RunOutcomes } from "./run-outcomes";
import { SectionCards } from "./section-cards";
import { UpNext } from "./up-next";

/**
 * The project's root: a morning review. What the night made, what comes next,
 * and how the flows do. Open Gates wait in the Inbox. Flows, runs and
 * schedules have their own pages.
 */
export function ProjectDashboardPage({ projectId }: { projectId: string }) {
	const summary = useQuery(dashboardQueries.summary({ projectId }));
	const [quickRun, setQuickRun] = useState(false);

	return (
		<ProjectPage projectId={projectId}>
			{(project) => (
				<>
					<PageHeading
						title={project.name}
						description={<ProjectFolderLine project={project} />}
						actions={
							<>
								<Button
									variant="outline"
									size="sm"
									onClick={() => setQuickRun(true)}
								>
									<ZapIcon data-icon="inline-start" />
									Quick run
								</Button>
								<ProjectMenu project={project} variant="outline" />
							</>
						}
					/>

					<SectionCards
						summary={summary.data}
						isLoading={summary.isLoading}
						project={project}
					/>

					<div className="grid gap-4 lg:grid-cols-3 lg:items-start">
						<NightOutput
							projectId={project.id}
							lastNight={summary.data?.lastNight}
							isLoading={summary.isLoading}
							onQuickRun={() => setQuickRun(true)}
							className="lg:col-span-2"
						/>
						<div className="flex flex-col gap-4">
							<UpNext projectId={project.id} upNext={summary.data?.upNext} />
							<RunOutcomes summary={summary.data} />
							<FlowCost summary={summary.data} />
						</div>
					</div>

					<FlowHealth project={project} summary={summary.data} />

					<ProjectClones project={project} />

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
