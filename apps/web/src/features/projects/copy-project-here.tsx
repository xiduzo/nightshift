import { useChanged } from "@nightshift/client";
import { Button } from "@nightshift/ui/components/button";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemMedia,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { Spinner } from "@nightshift/ui/components/spinner";
import { cn } from "@nightshift/ui/lib/utils";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CloudDownloadIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { orpc, type Project } from "@/shared/api";
import { useChooseProjectFolder } from "./choose-project-folder";
import { notHere } from "./projects";
import { projectMutations, projectQueries } from "./queries";

/** Whether Night Shift can copy the project from GitHub: its remote is there. */
function onGitHub(project: Pick<Project, "remote">): boolean {
	return project.remote?.toLowerCase().startsWith("github.com/") ?? false;
}

/**
 * How the copy of a project to this computer goes, while it runs or after
 * it failed. Null when none runs or failed. A copy that ends refreshes the
 * projects: it is a Clone here now, or a problem.
 */
export function useProjectCopy(
	project: Pick<Project, "id" | "repoPath" | "folder">,
) {
	const changed = useChanged({ orpc });
	const copies = useQuery({
		...projectQueries.copies(),
		enabled: notHere(project),
	});
	const copy = copies.data?.find((c) => c.projectId === project.id) ?? null;
	const copying = copy?.state === "copying";
	const wasCopying = useRef(false);
	useEffect(() => {
		// The copy is the project's folder here now.
		if (wasCopying.current && !copying) changed("projects");
		wasCopying.current = copying;
	}, [copying, changed]);
	return copy;
}

/**
 * A project that is not on this computer yet: how its copy from GitHub
 * goes, a button to copy it now or try again, and one to choose a copy
 * the person already has. A Host copies each project on its own. Nothing
 * when the project is here, or has no folder to copy.
 */
export function CopyProjectHere({
	project,
	className,
}: {
	project: Project;
	className?: string;
}) {
	const copy = useProjectCopy(project);
	const folder = useChooseProjectFolder(project);
	const start = useMutation(
		projectMutations.copyHere({
			onError: (error) => toast.error(error.message),
		}),
	);

	if (!notHere(project)) return null;
	const busy = copy?.state === "copying" || start.isPending;
	const canCopy = onGitHub(project);

	return (
		<Item variant="outline" size="sm" className={cn("w-full", className)}>
			<ItemMedia variant="icon">
				{busy ? <Spinner /> : <CloudDownloadIcon />}
			</ItemMedia>
			<ItemContent className="min-w-0">
				<ItemTitle>
					{busy ? "Copying from GitHub…" : "Not on this computer yet"}
				</ItemTitle>
				<ItemDescription className="line-clamp-none">
					{copy?.state === "failed"
						? copy.problem
						: busy
							? "A large project can take a few minutes."
							: canCopy
								? folder.available
									? `Copy ${project.remote} here, or choose a copy you already have.`
									: `Copy ${project.remote} here to use it on this computer.`
								: folder.available
									? "Choose its folder on this computer to use it here."
									: "Add its folder on this computer to use it here."}
				</ItemDescription>
			</ItemContent>
			{!busy && (canCopy || folder.available) ? (
				<ItemActions>
					{folder.available ? (
						<Button
							size="sm"
							variant={canCopy ? "ghost" : "outline"}
							disabled={folder.busy}
							onClick={folder.choose}
						>
							{folder.busy ? <Spinner data-icon="inline-start" /> : null}
							Choose folder…
						</Button>
					) : null}
					{canCopy ? (
						<Button
							size="sm"
							variant="outline"
							disabled={folder.busy}
							onClick={() => start.mutate({ projectId: project.id })}
						>
							{copy?.state === "failed" ? "Try again" : "Copy from GitHub"}
						</Button>
					) : null}
				</ItemActions>
			) : null}
		</Item>
	);
}
