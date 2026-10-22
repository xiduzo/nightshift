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
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@nightshift/ui/components/dropdown-menu";
import { Spinner } from "@nightshift/ui/components/spinner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
	ArrowRightLeftIcon,
	MoreHorizontalIcon,
	PencilIcon,
	Trash2Icon,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import type { Project } from "@/shared/api";
import { MoveProjectDialog, RenameProjectDialog } from "./project-actions";
import { projectFolder } from "./projects";
import { projectMutations } from "./queries";

/**
 * The ⋯ menu of a project: rename it, move it to another Space, or remove
 * it. `children` are items above these, such as "Open project".
 */
export function ProjectMenu({
	project,
	variant = "ghost",
	children,
}: {
	project: Project;
	variant?: "ghost" | "outline";
	children?: ReactNode;
}) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [dialog, setDialog] = useState<"rename" | "move" | "remove" | null>(
		null,
	);
	const close = (open: boolean) => {
		if (!open) setDialog(null);
	};
	const remove = useMutation(
		projectMutations.remove({
			onSuccess: async () => {
				setDialog(null);
				// Like a move: the project and its runs are gone from every page.
				await navigate({ to: "/" });
				await queryClient.invalidateQueries();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Button
							variant={variant}
							size="icon-sm"
							aria-label={`Actions for ${project.name}`}
							className={variant === "ghost" ? "text-muted-foreground" : ""}
						/>
					}
				>
					<MoreHorizontalIcon />
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="w-44">
					{children}
					<DropdownMenuItem onClick={() => setDialog("rename")}>
						<PencilIcon aria-hidden="true" />
						Rename…
					</DropdownMenuItem>
					<DropdownMenuItem onClick={() => setDialog("move")}>
						<ArrowRightLeftIcon aria-hidden="true" />
						Move to Space…
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem
						variant="destructive"
						disabled={remove.isPending}
						onClick={() => setDialog("remove")}
					>
						<Trash2Icon aria-hidden="true" />
						Remove project
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<RenameProjectDialog
				project={dialog === "rename" ? project : null}
				onOpenChange={close}
			/>
			<MoveProjectDialog
				project={dialog === "move" ? project : null}
				onOpenChange={close}
			/>
			<AlertDialog open={dialog === "remove"} onOpenChange={close}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							Remove {project.name} from Night Shift?
						</AlertDialogTitle>
						<AlertDialogDescription>
							Night Shift forgets the project and its runs. The repository at{" "}
							<span className="font-mono">{projectFolder(project)}</span> stays
							as it is.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							disabled={remove.isPending}
							onClick={() => remove.mutate({ projectId: project.id })}
						>
							{remove.isPending ? <Spinner data-icon="inline-start" /> : null}
							{remove.isPending ? "Removing…" : "Remove project"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
