import { Button } from "@nightshift/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { ZapIcon } from "lucide-react";
import { useState } from "react";
import {
	ProjectFolderLine,
	ProjectMenu,
	ProjectPage,
} from "@/features/projects";
import { QuickRunDialog } from "@/features/runs";
import type { DashboardSummary, Project } from "@/shared/api";
import { PageHeading } from "@/shared/page";
import { PrototypeSwitcher } from "@/shared/prototype-switcher";
import { FlowHealth } from "./flow-health";
import { NightOutput } from "./night-output";
import { ProjectClones } from "./project-clones";
import { VariantBrief } from "./prototype/variant-brief";
import { VariantConsole } from "./prototype/variant-console";
import { VariantLedger } from "./prototype/variant-ledger";
import { VariantObservatory } from "./prototype/variant-observatory";
import { dashboardQueries } from "./queries";
import { RunOutcomes } from "./run-outcomes";
import { SectionCards } from "./section-cards";
import { UpNext } from "./up-next";

/**
 * PROTOTYPE, throw away: the variants of the project dashboard, picked with
 * `?variant=`. "now" is the page as it is on main.
 */
const VARIANTS = [
	{ key: "now", name: "As it is now" },
	{ key: "A", name: "Morning brief" },
	{ key: "B", name: "Console" },
	{ key: "C", name: "Night ledger" },
	{ key: "D", name: "Observatory (future data)" },
] as const;

/** What every variant gets. */
export type VariantProps = {
	project: Project;
	/** Undefined while it loads. */
	summary: DashboardSummary | undefined;
	isLoading: boolean;
	onQuickRun: () => void;
};

/**
 * The project's root: a morning review. What the night made, what comes next,
 * and how the flows do. Open Gates wait in the Inbox. Flows, runs and
 * schedules have their own pages.
 */
export function ProjectDashboardPage({ projectId }: { projectId: string }) {
	const summary = useQuery(dashboardQueries.summary({ projectId }));
	const [quickRun, setQuickRun] = useState(false);
	const search = useSearch({ strict: false }) as { variant?: string };
	const variant = VARIANTS.some((v) => v.key === search.variant)
		? (search.variant as string)
		: "A";

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

					{variant !== "now" ? (
						<PrototypeVariant
							variant={variant}
							project={project}
							summary={summary.data}
							isLoading={summary.isLoading}
							onQuickRun={() => setQuickRun(true)}
						/>
					) : (
						<>
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
									<UpNext
										projectId={project.id}
										upNext={summary.data?.upNext}
									/>
									<RunOutcomes summary={summary.data} />
								</div>
							</div>

							<FlowHealth project={project} summary={summary.data} />

							<ProjectClones project={project} />
						</>
					)}

					<PrototypeSwitcher variants={VARIANTS} current={variant} />

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

function PrototypeVariant({
	variant,
	...props
}: VariantProps & { variant: string }) {
	if (variant === "A") return <VariantBrief {...props} />;
	if (variant === "B") return <VariantConsole {...props} />;
	if (variant === "C") return <VariantLedger {...props} />;
	return <VariantObservatory {...props} />;
}
