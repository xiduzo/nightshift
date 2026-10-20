import { Card, CardContent } from "@nightshift/ui/components/card";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ProjectList, projectQueries } from "@/features/projects";
import { RunList, runQueries } from "@/features/runs";
import { PageHeading, PageSection, SiteHeader } from "@/shared/page";

import { OVERVIEW_ROWS } from "./overview";
import { SectionCards } from "./section-cards";

/**
 * Home: tonight over all projects. The section cards, the recent runs, and
 * the projects.
 */
export function HomePage() {
	const queryClient = useQueryClient();
	const projects = useQuery(projectQueries.list());
	const runs = useQuery(runQueries.everyRun());

	const recentRuns = runs.data
		?.slice()
		.sort((a, b) => b.createdAt - a.createdAt)
		.slice(0, OVERVIEW_ROWS);

	return (
		<>
			<SiteHeader crumbs={[{ label: "Home" }]} />
			<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
				<PageHeading
					title="Tonight"
					description="What runs, what waits for you, and what it cost."
				/>

				<SectionCards
					runs={runs.data}
					isLoading={runs.isLoading}
					projects={projects.data}
				/>

				<PageSection
					title="Recent runs"
					description={`The last ${OVERVIEW_ROWS} runs over all projects, newest first.`}
				>
					<Card className="py-0">
						<CardContent className="px-0">
							<RunList
								runs={recentRuns}
								projects={projects.data}
								isLoading={runs.isLoading}
								emptyDescription="Open a project and start a run. It shows up here."
							/>
						</CardContent>
					</Card>
				</PageSection>

				<PageSection
					title="Projects"
					description="The code Night Shift works on. Open one to see its flows and runs."
				>
					<ProjectList
						projects={projects.data}
						runs={runs.data}
						isLoading={projects.isLoading}
						onRemoved={() =>
							void queryClient.invalidateQueries({ queryKey: runQueries.all() })
						}
					/>
				</PageSection>
			</div>
		</>
	);
}
