import { Badge } from "@nightshift/ui/components/badge";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronRightIcon } from "lucide-react";
import { projectQueries } from "@/features/projects";

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
	const projects = useQuery(projectQueries.list());
	// A project page shows the projects of the Space you work in only.
	const projectHere = projects.data?.some((p) => p.id === gate.projectId);
	return (
		<nav
			aria-label="Where"
			className="flex min-w-0 items-center gap-1 text-muted-foreground text-xs"
		>
			<Badge variant="outline" className="shrink-0">
				{gate.spaceName}
			</Badge>
			<ChevronRightIcon className="size-3 shrink-0" aria-hidden="true" />
			{projectHere ? (
				<Link
					to="/projects/$projectId"
					params={{ projectId: gate.projectId }}
					className="shrink-0 underline-offset-3 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
				>
					{gate.projectName}
				</Link>
			) : (
				<span className="shrink-0">{gate.projectName}</span>
			)}
			<ChevronRightIcon className="size-3 shrink-0" aria-hidden="true" />
			<Link
				to="/runs/$runId"
				params={{ runId: gate.runId }}
				className="min-w-0 truncate underline-offset-3 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
			>
				{gate.runTitle}
			</Link>
		</nav>
	);
}
