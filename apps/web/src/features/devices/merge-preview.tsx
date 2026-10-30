import { Badge } from "@nightshift/ui/components/badge";
import {
	Item,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemTitle,
} from "@nightshift/ui/components/item";

import type { MergePreview } from "@/shared/api";

const plural = (count: number, one: string, many = `${one}s`) =>
	`${count} ${count === 1 ? one : many}`;

/** Where one project of this computer's Personal goes, in the person's words. */
function whereItGoes(
	project: MergePreview["projects"][number],
	hostName: string,
): string {
	switch (project.into) {
		case "new":
			return "A project of its own.";
		case "same-remote":
			return `Joins the project with this repository on ${hostName}. Both keep their runs.`;
		case "shared":
			return `Joins the project with this repository in ${project.sharedSpace?.name}. Its members see these runs.`;
		case "apart":
			return `${project.sharedSpace?.name} has a project with this repository. This one stays apart from it.`;
	}
}

/**
 * The projects of this computer's Personal and where each one goes when
 * it merges into the home Host's Personal: what the person reads before
 * the merge, in the join dialog and the Devices page.
 */
export function MergePreviewList({ preview }: { preview: MergePreview }) {
	if (preview.projects.length === 0) {
		return (
			<p className="text-muted-foreground text-sm">
				Personal on this computer has no projects. Only its name changes.
			</p>
		);
	}
	return (
		<ItemGroup className="gap-2">
			{preview.projects.map((project) => (
				<Item key={project.id} size="sm" variant="outline">
					<ItemContent className="min-w-0">
						<ItemTitle className="flex flex-wrap items-center gap-2">
							{project.name}
							<Badge variant="secondary">{plural(project.runs, "run")}</Badge>
						</ItemTitle>
						<ItemDescription className="line-clamp-none">
							{whereItGoes(project, preview.host.name)}
							{project.renamedFlows.map((flow) => (
								<span key={flow.from} className="block">
									The flow {flow.from} is now {flow.to}.
								</span>
							))}
							{project.schedules > 0 ? (
								<span className="block">
									{plural(project.schedules, "schedule")} still{" "}
									{project.schedules === 1 ? "runs" : "run"} on this computer.
								</span>
							) : null}
						</ItemDescription>
					</ItemContent>
				</Item>
			))}
		</ItemGroup>
	);
}
