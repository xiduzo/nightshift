import { Card, CardContent } from "@nightshift/ui/components/card";
import { useQuery } from "@tanstack/react-query";
import { ProjectList, projectQueries } from "@/features/projects";
import { RunList, runQueries } from "@/features/runs";
import { PageHeading, PageSection, SiteHeader } from "@/shared/page";

import { OVERVIEW_ROWS } from "./overview";
import { dashboardQueries } from "./queries";
import { SectionCards } from "./section-cards";

/**
 * Home: tonight over all projects. The section cards, the recent runs, and
 * the projects.
 */
export function HomePage() {
	const projects = useQuery(projectQueries.list());
	// Recent runs and the project list, which shows how each project's runs stand.
	const runs = useQuery(runQueries.everyRun());
	const summary = useQuery(dashboardQueries.summary());

	return (
		<>
			<SiteHeader crumbs={[{ label: "Home" }]} />
			<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
				<PageHeading
					title="Tonight"
					description="What runs, what waits for you, and what it cost."
				/>

				<SectionCards summary={summary.data} isLoading={summary.isLoading} />

				<PageSection title="Recent runs">
					<Card className="py-0">
						<CardContent className="px-0">
							<RunList
								runs={runs.data}
								projects={projects.data}
								isLoading={runs.isLoading}
								pageSize={OVERVIEW_ROWS}
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
					/>
				</PageSection>
			</div>
		</>
	);
}
