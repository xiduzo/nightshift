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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CloudDownloadIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import type { Project } from "@/shared/api";
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
export function useProjectCopy(project: Pick<Project, "id" | "repoPath">) {
	const queryClient = useQueryClient();
	const copies = useQuery({
		...projectQueries.copies(),
		enabled: project.repoPath === null,
	});
	const copy = copies.data?.find((c) => c.projectId === project.id) ?? null;
	const copying = copy?.state === "copying";
	const wasCopying = useRef(false);
	useEffect(() => {
		if (wasCopying.current && !copying) {
			void queryClient.invalidateQueries({ queryKey: projectQueries.all() });
		}
		wasCopying.current = copying;
	}, [copying, queryClient]);
	return copy;
}

/**
 * A project that is not on this computer yet: how its copy from GitHub
 * goes, and a button to copy it now or try again. A Host copies each
 * project on its own. Nothing when the project is here.
 */
export function CopyProjectHere({
	project,
	className,
}: {
	project: Project;
	className?: string;
}) {
	const queryClient = useQueryClient();
	const copy = useProjectCopy(project);
	const start = useMutation(
		projectMutations.copyHere({
			onSuccess: () =>
				queryClient.invalidateQueries({
					queryKey: projectQueries.copies().queryKey,
				}),
			onError: (error) => toast.error(error.message),
		}),
	);

	if (project.repoPath !== null) return null;
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
								? `Copy ${project.remote} here to use it on this computer.`
								: "Add its folder on this computer to use it here."}
				</ItemDescription>
			</ItemContent>
			{canCopy && !busy ? (
				<ItemActions>
					<Button
						size="sm"
						variant="outline"
						onClick={() => start.mutate({ projectId: project.id })}
					>
						{copy?.state === "failed" ? "Try again" : "Copy from GitHub"}
					</Button>
				</ItemActions>
			) : null}
		</Item>
	);
}
