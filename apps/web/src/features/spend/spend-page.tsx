import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@nightshift/ui/components/empty";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { CircleAlertIcon, CircleHelpIcon, CoinsIcon } from "lucide-react";
import { RangeBar } from "@/features/dashboard";
import { projectQueries } from "@/features/projects";
import type { NightRange } from "@/shared/api";
import { PageHeading, PageSection, SiteHeader } from "@/shared/page";
import { HelpCost } from "./help-cost";
import { spendQuery } from "./queries";
import { SpendFlows } from "./spend-flows";
import { SpendTiles } from "./spend-tiles";
import { WaysToSave } from "./ways-to-save";

/**
 * Spend: the money of the Space, for the person who pays. One range for
 * the whole page, in the toolbar. On top, what the runs spent against the days before,
 * how many flows have a steady cost, and what a change could save. Under
 * it, one row per flow with its cost against a usual run of that flow,
 * and beside it the ways to save, the biggest first, then what Night
 * Shift's own agents cost (Help), which is in no run. Home and a project's
 * page keep cost only as evidence of a flow.
 */
export function SpendPage({
	range,
	onRangeChange,
}: {
	range: NightRange;
	onRangeChange: (range: NightRange) => void;
}) {
	const spend = useQuery(spendQuery());
	const projects = useQuery(projectQueries.list());
	const days = spend.data?.ranges.find((r) => r.nights === range);
	const projectName = (projectId: string) =>
		projects.data?.find((project) => project.id === projectId)?.name;

	return (
		<>
			<SiteHeader crumbs={[{ label: "Spend" }]}>
				<RangeBar value={range} onValueChange={onRangeChange} />
			</SiteHeader>
			<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
				<PageHeading
					title="Spend"
					description="What your flows cost, how steady that cost is, and where a change saves money."
				/>

				{spend.error && !days ? (
					<Alert variant="destructive">
						<CircleAlertIcon />
						<AlertTitle>Night Shift could not load the spend</AlertTitle>
						<AlertDescription>
							Update Night Shift on the computer that runs your flows. Then open
							this page again.
						</AlertDescription>
					</Alert>
				) : !days ? (
					<>
						<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
							<Skeleton className="h-36 w-full rounded-xl" />
							<Skeleton className="h-36 w-full rounded-xl" />
							<Skeleton className="h-36 w-full rounded-xl" />
							<Skeleton className="h-36 w-full rounded-xl" />
						</div>
						<Skeleton className="h-64 w-full rounded-xl" />
					</>
				) : days.runs === 0 && days.help.answers === 0 ? (
					<Empty className="border border-dashed">
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<CoinsIcon />
							</EmptyMedia>
							<EmptyTitle>No run in the last {range} days</EmptyTitle>
							<EmptyDescription>
								Start a flow, or give one a schedule. This page shows what its
								runs cost.
							</EmptyDescription>
						</EmptyHeader>
					</Empty>
				) : (
					<>
						{days.unknown > 0 ? (
							<Alert>
								<CircleHelpIcon />
								<AlertTitle>Some costs are not known</AlertTitle>
								<AlertDescription>
									{days.unknown === 1
										? `1 run in the last ${range} days has a step that did not report its cost.`
										: `${days.unknown} runs in the last ${range} days have a step that did not report its cost.`}{" "}
									The totals do not include those steps.
								</AlertDescription>
							</Alert>
						) : null}
						<SpendTiles days={days} />
						<div className="grid items-start gap-8 xl:grid-cols-[minmax(0,3fr)_minmax(24rem,2fr)]">
							<PageSection
								title="How predictable each flow is"
								description={`Each strip shows what a run cost against a usual run of that flow, in the last ${range} days. A short strip means a steady cost.`}
							>
								<SpendFlows days={days} projectName={projectName} />
							</PageSection>
							<div className="flex min-w-0 flex-col gap-8">
								<WaysToSave days={days} projectName={projectName} />
								<HelpCost days={days} />
							</div>
						</div>
					</>
				)}
			</div>
		</>
	);
}
