import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Project } from "@/shared/api";
import { projectMutations, projectQueries } from "./queries";
import { useMayChange } from "./use-may-change";

/**
 * Lets a person choose a folder on this computer as the project's folder
 * here: a copy they already have, or a new place for the one it has. The
 * server opens the folder picker on its own computer, so only where it
 * can (`available`), and only where their role lets them (`allowed`).
 */
export function useChooseProjectFolder(project: Pick<Project, "id">) {
	const allowed = useMayChange();
	const sources = useQuery(projectQueries.sources());
	const use = useMutation(
		projectMutations.useFolder({
			onSuccess: (used) => {
				toast.success(`${used.name} uses this folder now`, {
					description: used.repoPath ?? undefined,
				});
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const choose = useMutation(
		projectMutations.chooseFolder({
			onSuccess: (path) => {
				if (path) use.mutate({ projectId: project.id, repoPath: path });
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	return {
		available: sources.data?.folderPicker === true,
		allowed,
		busy: choose.isPending || use.isPending,
		choose: () => choose.mutate({ purpose: "use" }),
	};
}
