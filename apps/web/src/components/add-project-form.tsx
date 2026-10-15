import { Button } from "@nightshift/ui/components/button";
import { Input } from "@nightshift/ui/components/input";
import { Label } from "@nightshift/ui/components/label";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";

export function AddProjectForm() {
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
			},
		}),
	);

	const trimmedPath = repoPath.trim();
	const pathIsAbsolute = trimmedPath.startsWith("/");

	return (
		<form
			className="flex flex-col gap-3"
			onSubmit={(event) => {
				event.preventDefault();
				if (!pathIsAbsolute) return;
				addProject.mutate({
					repoPath: trimmedPath,
					name: name.trim() || undefined,
				});
			}}
		>
			<div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
				<div className="flex flex-col gap-1.5">
					<Label htmlFor={`${id}-path`}>Repository path</Label>
					<Input
						id={`${id}-path`}
						value={repoPath}
						onChange={(event) => setRepoPath(event.target.value)}
						placeholder="/Users/you/code/repo"
						className="font-mono"
						autoComplete="off"
						spellCheck={false}
						required
						aria-invalid={trimmedPath !== "" && !pathIsAbsolute}
						aria-describedby={`${id}-path-hint`}
					/>
					<p id={`${id}-path-hint`} className="text-muted-foreground text-xs">
						{trimmedPath !== "" && !pathIsAbsolute
							? "Use an absolute path, starting with /."
							: "The top level of a git repository."}
					</p>
				</div>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor={`${id}-name`}>
						Name <span className="text-muted-foreground">(optional)</span>
					</Label>
					<Input
						id={`${id}-name`}
						value={name}
						onChange={(event) => setName(event.target.value)}
						placeholder="Folder name"
						autoComplete="off"
					/>
				</div>
			</div>
			{addProject.error ? (
				<p role="alert" className="text-destructive text-xs">
					{addProject.error.message}
				</p>
			) : null}
			<div>
				<Button
					type="submit"
					disabled={!pathIsAbsolute || addProject.isPending}
				>
					{addProject.isPending ? "Adding…" : "Add project"}
				</Button>
			</div>
		</form>
	);
}
