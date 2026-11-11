import { formatDay, gateRun, now } from "@nightshift/client";
import { Badge } from "@nightshift/ui/components/badge";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronRightIcon } from "lucide-react";
import { projectQueries } from "@/features/projects";
import { formatDayTime, formatTime } from "@/shared/format";
import { LocalTime } from "@/shared/time";

const LINK =
	"underline-offset-3 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/50";

/** A project's name: a link when its page is in the Space you work in. */
function ProjectName({
	projectId,
	projectName,
}: {
	projectId: string;
	projectName: string;
}) {
	const projects = useQuery(projectQueries.list());
	// A project page shows the projects of the Space you work in only.
	const projectHere = projects.data?.some((p) => p.id === projectId);
	return projectHere ? (
		<Link
			to="/projects/$projectId"
			params={{ projectId }}
			className={`shrink-0 ${LINK}`}
		>
			{projectName}
		</Link>
	) : (
		<span className="shrink-0">{projectName}</span>
	);
}

/** Where a Gate is: its Space, its project and its run, each a link where it can be. */
export function GateWhere({
	gate,
}: {
	gate: {
		spaceName: string;
		projectId: string;
		projectName: string;
		runId: string;
		runTitle: string;
	};
}) {
	return (
		<nav
			aria-label="Where"
			className="flex min-w-0 items-center gap-1 text-muted-foreground text-xs"
		>
			<Badge variant="outline" className="shrink-0">
				{gate.spaceName}
			</Badge>
			<ChevronRightIcon className="size-3 shrink-0" aria-hidden="true" />
			<ProjectName projectId={gate.projectId} projectName={gate.projectName} />
			<ChevronRightIcon className="size-3 shrink-0" aria-hidden="true" />
			<Link
				to="/runs/$runId"
				params={{ runId: gate.runId }}
				className={`min-w-0 truncate ${LINK}`}
			>
				{gate.runTitle}
			</Link>
		</nav>
	);
}

/** Who hands a Gate over: its flow, its project in its Space, and when it asked. */
export function GateFrom({
	gate,
}: {
	gate: {
		spaceName: string;
		projectId: string;
		projectName: string;
		runId: string;
		runTitle: string;
		flowName: string | null;
		openedAt: number;
	};
}) {
	const { flow, detail } = gateRun(gate);
	return (
		<p className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-muted-foreground text-xs">
			<Link
				to="/runs/$runId"
				params={{ runId: gate.runId }}
				className={`min-w-0 truncate font-medium font-mono text-foreground ${LINK}`}
				title={gate.runTitle}
			>
				{flow}
				{detail ? (
					<span className="font-normal font-sans text-muted-foreground">
						{" "}
						{detail}
					</span>
				) : null}
			</Link>
			<span aria-hidden="true">·</span>
			<ProjectName projectId={gate.projectId} projectName={gate.projectName} />
			<Badge variant="outline" className="shrink-0">
				{gate.spaceName}
			</Badge>
			<span aria-hidden="true">·</span>
			<LocalTime at={gate.openedAt} className="tabular-nums">
				{askedAt(gate.openedAt)}
			</LocalTime>
		</p>
	);
}

/** "14:05" for a moment today, "Thu 16 Oct, 07:00" for another day. */
function askedAt(at: number): string {
	const today = formatDay(at) === formatDay(now());
	return today ? formatTime(at) : formatDayTime(at);
}
