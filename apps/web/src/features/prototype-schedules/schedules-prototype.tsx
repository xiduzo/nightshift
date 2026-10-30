/**
 * PROTOTYPE, throw away. The project's Schedules page, four ways,
 * switchable through `?variant=` on the existing
 * `/projects/$projectId/schedules` route: A an agenda of the coming week,
 * B one card per schedule like the Flows page, C a timeline with a lane
 * per schedule, D today's table. Nothing saves: the schedules are real.
 */

import { Button } from "@nightshift/ui/components/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@nightshift/ui/components/empty";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { CalendarClockIcon, PlusIcon } from "lucide-react";
import { ProjectPage } from "@/features/projects";
import { ProjectSchedulesPage } from "@/features/schedules";
import { useNow } from "@/shared/format";
import { PageHeading } from "@/shared/page";
import { PrototypeSwitcher } from "@/shared/prototype-switcher";
import { Notices, stub } from "./schedule-parts";
import { type ScheduleRow, useScheduleRows } from "./schedules-data";
import { VariantAgenda } from "./variant-agenda";
import { VariantCards } from "./variant-cards";
import { VariantLanes } from "./variant-lanes";

const VARIANTS = [
	{ key: "A", name: "Agenda of the week" },
	{ key: "B", name: "Cards, like Flows" },
	{ key: "C", name: "Timeline lanes" },
	{ key: "D", name: "Today: table" },
] as const;

/** What every variant gets. */
export type VariantProps = {
	projectId: string;
	rows: ScheduleRow[];
	now: number;
	schedulerOff: boolean;
};

export function SchedulesPrototype({
	projectId,
	variant = "A",
}: {
	projectId: string;
	variant?: string;
}) {
	const switcher = <PrototypeSwitcher variants={VARIANTS} current={variant} />;
	if (variant === "D") {
		return (
			<>
				<ProjectSchedulesPage projectId={projectId} />
				{switcher}
			</>
		);
	}
	return (
		<ProjectPage projectId={projectId} section="Schedules">
			{(project) => (
				<>
					<SchedulesPage projectId={project.id} variant={variant} />
					{switcher}
				</>
			)}
		</ProjectPage>
	);
}

function SchedulesPage({
	projectId,
	variant,
}: {
	projectId: string;
	variant: string;
}) {
	const now = useNow(30_000);
	const data = useScheduleRows(projectId, now);
	const props: VariantProps | null = data.rows
		? { projectId, rows: data.rows, now, schedulerOff: data.schedulerOff }
		: null;

	return (
		<section
			aria-labelledby="schedules-heading"
			className="flex flex-col gap-4"
		>
			<PageHeading
				id="schedules-heading"
				title="Schedules"
				description={
					data.starter
						? `Flows that start on their own, at set times or when a webhook arrives. ${data.starter}, the Host, starts them.`
						: "Flows that start on their own, at set times or when a webhook arrives."
				}
				actions={
					<Button
						variant="outline"
						size="sm"
						onClick={() => stub("a new schedule")}
					>
						<PlusIcon data-icon="inline-start" />
						New schedule
					</Button>
				}
			/>
			<Notices issues={data.listIssues} schedulerOff={data.schedulerOff} />
			{data.loading || !props ? (
				<Skeleton className="h-40 w-full" />
			) : props.rows.length === 0 ? (
				<Empty>
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<CalendarClockIcon aria-hidden="true" />
						</EmptyMedia>
						<EmptyTitle>No schedules</EmptyTitle>
						<EmptyDescription>
							{data.error?.message ??
								"Let a flow run on its own, for example every night from 22:00 to 07:00."}
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : variant === "B" ? (
				<VariantCards {...props} />
			) : variant === "C" ? (
				<VariantLanes {...props} />
			) : (
				<VariantAgenda {...props} />
			)}
		</section>
	);
}
