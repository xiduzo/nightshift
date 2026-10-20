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
	FieldError,
	FieldGroup,
	FieldLabel,
} from "@nightshift/ui/components/field";
import { Input } from "@nightshift/ui/components/input";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemMedia,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { Spinner } from "@nightshift/ui/components/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderGitIcon, FolderOpenIcon, PlusIcon } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { ProjectReadiness } from "./project-readiness";
import { projectMutations, projectQueries } from "./queries";

/** Adds a folder as a project, in a dialog, after its readiness check. */
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

	// The server opens the native folder picker on this Mac.
	const chooseFolder = useMutation(
		projectMutations.chooseFolder({
			onSuccess: (path) => {
				if (path) setRepoPath(path);
			},
		}),
	);

	const addProject = useMutation(
		projectMutations.add({
			onSuccess: (project) => {
				toast.success(`Added ${project.name}`);
				setRepoPath("");
				setName("");
				void queryClient.invalidateQueries({
					queryKey: projectQueries.all(),
				});
				onAdded?.();
			},
		}),
	);

	const readiness = useQuery({
		...projectQueries.check(repoPath),
		enabled: repoPath !== "",
	});
	const ready = readiness.data?.ready === true;

	const folderName = repoPath.split("/").at(-1) || repoPath;

	return (
		<form
			className="contents"
			onSubmit={(event) => {
				event.preventDefault();
				if (!repoPath || !ready) return;
				addProject.mutate({ repoPath, name: name.trim() || undefined });
			}}
		>
			<DialogHeader>
				<DialogTitle>Add project</DialogTitle>
				<DialogDescription>
					Choose a project folder on this Mac. Each run works in its own copy,
					so your files stay as they are.
				</DialogDescription>
			</DialogHeader>
			<FieldGroup className="gap-5">
				<Field data-invalid={chooseFolder.error ? true : undefined}>
					<FieldLabel>Folder</FieldLabel>
					{repoPath ? (
						<Item variant="outline" size="sm">
							<ItemMedia variant="icon">
								<FolderGitIcon />
							</ItemMedia>
							<ItemContent className="min-w-0">
								<ItemTitle>{folderName}</ItemTitle>
								<ItemDescription
									className="truncate font-mono"
									title={repoPath}
								>
									{repoPath}
								</ItemDescription>
							</ItemContent>
							<ItemActions>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									disabled={chooseFolder.isPending}
									onClick={() => chooseFolder.mutate()}
								>
									{chooseFolder.isPending ? (
										<Spinner data-icon="inline-start" />
									) : null}
									Change
								</Button>
							</ItemActions>
						</Item>
					) : (
						<Button
							type="button"
							variant="outline"
							disabled={chooseFolder.isPending}
							onClick={() => chooseFolder.mutate()}
							autoFocus
						>
							{chooseFolder.isPending ? (
								<Spinner data-icon="inline-start" />
							) : (
								<FolderOpenIcon data-icon="inline-start" />
							)}
							{chooseFolder.isPending ? "Choosing…" : "Choose folder…"}
						</Button>
					)}
					{chooseFolder.error ? (
						<FieldError>{chooseFolder.error.message}</FieldError>
					) : null}
				</Field>
				{readiness.data && !ready ? (
					<ProjectReadiness
						readiness={readiness.data}
						checking={readiness.isFetching}
						onRecheck={() => void readiness.refetch()}
						onUseFolder={setRepoPath}
					/>
				) : null}
				{readiness.error ? (
					<FieldError>{readiness.error.message}</FieldError>
				) : null}
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
						placeholder={folderName || "Folder name"}
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
					disabled={!repoPath || !ready || addProject.isPending}
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
