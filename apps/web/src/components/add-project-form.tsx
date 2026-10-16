import { Button } from "@nightshift/ui/components/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@nightshift/ui/components/dialog";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "@nightshift/ui/components/field";
import { Input } from "@nightshift/ui/components/input";
import { Spinner } from "@nightshift/ui/components/spinner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";

/** Adds a git repository as a project, in a dialog. */
export function AddProjectDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				{open ? <AddProjectForm onAdded={() => onOpenChange(false)} /> : null}
			</DialogContent>
		</Dialog>
	);
}

export function AddProjectForm({ onAdded }: { onAdded?: () => void }) {
	const id = useId();
	const queryClient = useQueryClient();
	const [repoPath, setRepoPath] = useState("");
	const [name, setName] = useState("");

	const addProject = useMutation(
		orpc.projects.add.mutationOptions({
			onSuccess: (project) => {
				toast.success(`Added ${project.name}`);
				setRepoPath("");
				setName("");
				void queryClient.invalidateQueries({
					queryKey: orpc.projects.key(),
				});
				onAdded?.();
			},
		}),
	);

	const trimmedPath = repoPath.trim();
	const pathIsAbsolute = trimmedPath.startsWith("/");
	const pathInvalid = trimmedPath !== "" && !pathIsAbsolute;

	return (
		<form
			className="contents"
			onSubmit={(event) => {
				event.preventDefault();
				if (!pathIsAbsolute) return;
				addProject.mutate({
					repoPath: trimmedPath,
					name: name.trim() || undefined,
				});
			}}
		>
			<DialogHeader>
				<DialogTitle>Add project</DialogTitle>
				<DialogDescription>
					A git repository on this Mac. Each run gets its own worktree in it.
				</DialogDescription>
			</DialogHeader>
			<FieldGroup className="gap-5">
				<Field data-invalid={pathInvalid || undefined}>
					<FieldLabel htmlFor={`${id}-path`}>Repository path</FieldLabel>
					<Input
						id={`${id}-path`}
						value={repoPath}
						onChange={(event) => setRepoPath(event.target.value)}
						placeholder="/Users/you/code/repo"
						className="font-mono"
						autoComplete="off"
						spellCheck={false}
						required
						autoFocus
						aria-invalid={pathInvalid}
						aria-describedby={`${id}-path-hint`}
					/>
					{pathInvalid ? (
						<FieldError id={`${id}-path-hint`}>
							Use an absolute path, starting with /.
						</FieldError>
					) : (
						<FieldDescription id={`${id}-path-hint`}>
							The top level of a git repository.
						</FieldDescription>
					)}
				</Field>
				<Field>
					<FieldLabel htmlFor={`${id}-name`}>
						Name{" "}
						<span className="font-normal text-muted-foreground">
							(optional)
						</span>
					</FieldLabel>
					<Input
						id={`${id}-name`}
						value={name}
						onChange={(event) => setName(event.target.value)}
						placeholder="Folder name"
						autoComplete="off"
					/>
				</Field>
				{addProject.error ? (
					<FieldError>{addProject.error.message}</FieldError>
				) : null}
			</FieldGroup>
			<DialogFooter>
				<DialogClose render={<Button variant="outline" type="button" />}>
					Cancel
				</DialogClose>
				<Button
					type="submit"
					disabled={!pathIsAbsolute || addProject.isPending}
				>
					{addProject.isPending ? (
						<Spinner data-icon="inline-start" />
					) : (
						<PlusIcon data-icon="inline-start" />
					)}
					{addProject.isPending ? "Adding…" : "Add project"}
				</Button>
			</DialogFooter>
		</form>
	);
}
