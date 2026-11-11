import { hasFolder } from "@nightshift/client";
import { Spinner } from "@nightshift/ui/components/spinner";
import { cn } from "@nightshift/ui/lib/utils";
import type { Project } from "@/shared/api";
import { useProjectCopy } from "./copy-project-here";
import { projectFolder } from "./projects";

/**
 * Under a project's name: its folder on this computer, else how its copy
 * from GitHub goes, so a person sees it without looking for it. A project
 * without a folder says so.
 */
export function ProjectFolderLine({
	project,
	className,
}: {
	project: Project;
	className?: string;
}) {
	const copy = useProjectCopy(project);
	if (!hasFolder(project)) {
		return (
			<span className={cn("block", className)}>
				No folder. Each run starts in an empty folder of its own.
			</span>
		);
	}
	if (copy?.state === "copying") {
		return (
			<span
				aria-live="polite"
				className={cn("flex items-center gap-2", className)}
			>
				<Spinner />
				Copying from GitHub to this computer. A large project can take a few
				minutes.
			</span>
		);
	}
	if (copy?.state === "failed") {
		return (
			<span className={cn("block text-destructive", className)}>
				Not on this computer. The copy from GitHub failed.
			</span>
		);
	}
	return (
		<span
			className={cn("block truncate font-mono", className)}
			title={projectFolder(project)}
		>
			{projectFolder(project)}
		</span>
	);
}
