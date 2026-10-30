import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@nightshift/ui/components/alert-dialog";
import { Button } from "@nightshift/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@nightshift/ui/components/dropdown-menu";
import { Spinner } from "@nightshift/ui/components/spinner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
	FolderMinusIcon,
	GitBranchIcon,
	MoreHorizontalIcon,
	TriangleAlertIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { projectMutations, projectQueries } from "@/features/projects";
import type { RunCopy } from "@/shared/api";

/**
 * The ⋯ menu of one run on the Branches page: remove its copy of the
 * project, or delete its branches. Each asks first, and warns harder when
 * work would be lost. A run that is still going has no actions.
 */
export function RunCopyMenu({
	projectId,
	copy,
}: {
	projectId: string;
	copy: RunCopy;
}) {
	const queryClient = useQueryClient();
	const [dialog, setDialog] = useState<"copy" | "branches" | null>(null);
	const close = (open: boolean) => {
		if (!open) setDialog(null);
	};
	const done = (message: string) => async () => {
		setDialog(null);
		toast.success(message);
		await queryClient.invalidateQueries({
			queryKey: projectQueries.runCopiesKey(projectId),
		});
	};
	const removeCopy = useMutation(
		projectMutations.removeRunCopy({
			onSuccess: done("Copy removed"),
			onError: (error) => toast.error(error.message),
		}),
	);
	const deleteBranches = useMutation(
		projectMutations.deleteRunBranches({
			onSuccess: done(
				copy.branches.length === 1 ? "Branch deleted" : "Branches deleted",
			),
			onError: (error) => toast.error(error.message),
		}),
	);

	if (copy.active || (!copy.copy && copy.branches.length === 0)) return null;

	const changes = copy.changes ?? 0;
	const unsaved = copy.branches.reduce((sum, b) => sum + b.unsaved, 0);
	const branchWord = copy.branches.length === 1 ? "branch" : "branches";

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label={`Actions for ${copy.title}`}
							className="text-muted-foreground"
						/>
					}
				>
					<MoreHorizontalIcon />
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="w-52">
					<DropdownMenuItem
						disabled={!copy.copy}
						onClick={() => setDialog("copy")}
					>
						<FolderMinusIcon aria-hidden="true" />
						Remove copy…
					</DropdownMenuItem>
					<DropdownMenuItem
						variant="destructive"
						disabled={copy.copy || copy.branches.length === 0}
						title={copy.copy ? "Remove the copy first." : undefined}
						onClick={() => setDialog("branches")}
					>
						<GitBranchIcon aria-hidden="true" />
						{copy.copy
							? "Delete branches (remove the copy first)"
							: `Delete ${branchWord}…`}
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>

			<AlertDialog open={dialog === "copy"} onOpenChange={close}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Remove the copy of this run?</AlertDialogTitle>
						<AlertDialogDescription>
							Night Shift removes the run's own copy of the project from this
							computer. Its branches stay, with all their commits.
						</AlertDialogDescription>
					</AlertDialogHeader>
					{changes > 0 || copy.changes === null ? (
						<Alert variant="destructive">
							<TriangleAlertIcon />
							<AlertTitle>Changes that are not committed are lost</AlertTitle>
							<AlertDescription>
								{copy.changes === null
									? "Night Shift cannot see if the copy has changes. If you remove it, you lose them for good."
									: `${changes === 1 ? "1 file has" : `${changes} files have`} changes that are not committed. If you remove the copy, you lose them for good.`}
							</AlertDescription>
						</Alert>
					) : null}
					<AlertDialogFooter>
						<AlertDialogCancel>Keep copy</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							disabled={removeCopy.isPending}
							onClick={() =>
								removeCopy.mutate({
									runId: copy.runId,
									force: changes > 0 || copy.changes === null,
								})
							}
						>
							{removeCopy.isPending ? (
								<Spinner data-icon="inline-start" />
							) : null}
							{removeCopy.isPending ? "Removing…" : "Remove copy"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			<AlertDialog open={dialog === "branches"} onOpenChange={close}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							Delete the {branchWord} of this run?
						</AlertDialogTitle>
						<AlertDialogDescription>
							Night Shift deletes{" "}
							{copy.branches.length === 1
								? "1 branch"
								: `${copy.branches.length} branches`}{" "}
							on this computer. Branches on origin stay.
						</AlertDialogDescription>
					</AlertDialogHeader>
					{unsaved > 0 ? (
						<Alert variant="destructive">
							<TriangleAlertIcon />
							<AlertTitle>Work that is only here is lost</AlertTitle>
							<AlertDescription>
								{unsaved === 1 ? "1 commit is" : `${unsaved} commits are`} not
								merged and not pushed. Deleting the {branchWord} deletes{" "}
								{unsaved === 1 ? "it" : "them"} for good.
							</AlertDescription>
						</Alert>
					) : null}
					<AlertDialogFooter>
						<AlertDialogCancel>Keep {branchWord}</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							disabled={deleteBranches.isPending}
							onClick={() =>
								deleteBranches.mutate({
									runId: copy.runId,
									force: unsaved > 0,
								})
							}
						>
							{deleteBranches.isPending ? (
								<Spinner data-icon="inline-start" />
							) : null}
							{deleteBranches.isPending ? "Deleting…" : `Delete ${branchWord}`}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
