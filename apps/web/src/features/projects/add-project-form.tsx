import { Button } from "@nightshift/ui/components/button";
import { Checkbox } from "@nightshift/ui/components/checkbox";
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
	FieldContent,
	FieldDescription,
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
import { Tabs, TabsList, TabsTrigger } from "@nightshift/ui/components/tabs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderGitIcon, FolderOpenIcon, PlusIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { GitHubCopyStatus, GitHubRepoField } from "./github-repo-field";
import { ProjectReadiness } from "./project-readiness";
import { projectMutations, projectQueries } from "./queries";

/** Where a new project comes from: a folder on this computer, or a GitHub repository. */
type Source = "folder" | "github";

/** Adds a folder or a GitHub repository as a project, in a dialog, after its readiness check. */
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
	const sources = useQuery(projectQueries.sources());
	// Until the server answers, assume the folder picker: most computers are Macs.
	const folderPicker = sources.data?.folderPicker ?? true;
	const [chosen, setChosen] = useState<Source | null>(null);
	const source: Source = folderPicker ? (chosen ?? "folder") : "github";

	const [folderPath, setFolderPath] = useState("");
	const [repo, setRepo] = useState("");
	const [name, setName] = useState("");
	const [starters, setStarters] = useState(true);
	/** The person asked to add the GitHub repository: add it once its copy is ready. */
	const [addWhenReady, setAddWhenReady] = useState(false);

	// The server opens the folder picker on its own computer.
	const chooseFolder = useMutation(
		projectMutations.chooseFolder({
			onSuccess: (path) => {
				if (path) setFolderPath(path);
			},
		}),
	);

	// The copy from GitHub runs on the server. Its status is polled while it copies.
	const startCopy = useMutation(projectMutations.cloneFromGitHub());
	const copyRepo = startCopy.data?.repo ?? "";
	const copyStatus = useQuery({
		...projectQueries.gitHubClone(copyRepo),
		enabled: startCopy.data?.state === "cloning",
	});
	const copy = copyStatus.data ?? startCopy.data ?? null;
	const copying = startCopy.isPending || copy?.state === "cloning";
	const copyProblem =
		startCopy.error?.message ??
		(copy?.state === "failed" ? copy.problem : null) ??
		(copyStatus.data === null && !copyStatus.isFetching && startCopy.data
			? "Night Shift stopped copying the repository. Try again."
			: null);
	const gitHubPath = copy?.state === "done" ? copy.path : "";

	const repoPath = source === "folder" ? folderPath : gitHubPath;

	const addProject = useMutation(
		projectMutations.add({
			onSuccess: (project, variables) => {
				toast.success(
					`Added ${project.name}`,
					variables.starters
						? { description: "Its starter flows are in its flow list." }
						: undefined,
				);
				setFolderPath("");
				setRepo("");
				setName("");
				startCopy.reset();
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

	const folderName = folderPath.split("/").at(-1) || folderPath;
	// The folder of a copy is in lower case: the repository keeps its own name.
	const repoName = (copy?.repo ?? repo).split("/").at(-1)?.trim() ?? "";
	const defaultName = source === "folder" ? folderName : repoName;

	const add = () =>
		addProject.mutate({
			repoPath,
			name: name.trim() || (source === "github" ? repoName : undefined),
			starters,
		});

	// Add the repository as soon as its copy is ready, when the person asked for it.
	useEffect(() => {
		if (!addWhenReady || source !== "github") return;
		if (copy?.state === "failed" || startCopy.error) setAddWhenReady(false);
		else if (readiness.data && !readiness.isFetching) {
			setAddWhenReady(false);
			if (readiness.data.ready && !addProject.isPending) add();
		}
	});

	const submit = () => {
		if (source === "folder") {
			if (folderPath && ready) add();
			return;
		}
		if (gitHubPath) {
			if (ready) add();
			return;
		}
		if (!repo.trim() || copying) return;
		setAddWhenReady(true);
		startCopy.mutate({ repo: repo.trim() });
	};

	const busy = addProject.isPending || (source === "github" && copying);
	const canSubmit =
		source === "folder"
			? Boolean(folderPath) && ready
			: gitHubPath
				? ready
				: repo.trim() !== "";

	return (
		<form
			className="contents"
			onSubmit={(event) => {
				event.preventDefault();
				submit();
			}}
		>
			<DialogHeader>
				<DialogTitle>Add project</DialogTitle>
				<DialogDescription>
					{folderPicker
						? "Choose a folder on this computer, or copy a repository from GitHub. Each run works in its own copy, so your files stay as they are."
						: "Copy a repository from GitHub to this computer. Each run works in its own copy of it."}
				</DialogDescription>
			</DialogHeader>
			<FieldGroup className="gap-5">
				{folderPicker ? (
					<Tabs
						value={source}
						onValueChange={(next) => setChosen(next as Source)}
					>
						<TabsList className="w-full">
							<TabsTrigger value="folder">Folder</TabsTrigger>
							<TabsTrigger value="github">GitHub</TabsTrigger>
						</TabsList>
					</Tabs>
				) : null}
				{source === "folder" ? (
					<Field data-invalid={chooseFolder.error ? true : undefined}>
						<FieldLabel>Folder</FieldLabel>
						{folderPath ? (
							<Item variant="outline" size="sm">
								<ItemMedia variant="icon">
									<FolderGitIcon />
								</ItemMedia>
								<ItemContent className="min-w-0">
									<ItemTitle>{folderName}</ItemTitle>
									<ItemDescription
										className="truncate font-mono"
										title={folderPath}
									>
										{folderPath}
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
				) : (
					<>
						<GitHubRepoField
							id={`${id}-repo`}
							access={sources.data?.gitHub ?? "missing"}
							value={repo}
							onChange={(next) => {
								setRepo(next);
								// Another repository: its copy starts again.
								if (startCopy.data || startCopy.error) startCopy.reset();
								setAddWhenReady(false);
							}}
							disabled={copying}
							error={copyProblem}
						/>
						{copy && copy.state !== "failed" ? (
							<GitHubCopyStatus
								repo={copy.repo}
								copying={copy.state === "cloning"}
								reused={copy.state === "done" && copy.reused}
							/>
						) : null}
					</>
				)}
				{repoPath && readiness.data && !ready ? (
					<ProjectReadiness
						readiness={readiness.data}
						checking={readiness.isFetching}
						onRecheck={() => void readiness.refetch()}
						onUseFolder={setFolderPath}
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
						placeholder={defaultName || "Project name"}
						autoComplete="off"
					/>
				</Field>
				<Field orientation="horizontal">
					<Checkbox
						id={`${id}-starters`}
						checked={starters}
						onCheckedChange={(checked) => setStarters(checked === true)}
					/>
					<FieldContent>
						<FieldLabel htmlFor={`${id}-starters`}>
							Add the starter flows
						</FieldLabel>
						<FieldDescription>
							Six small flows to change and run, for example implement and
							check, or review a pull request.
						</FieldDescription>
					</FieldContent>
				</Field>
				{addProject.error ? (
					<FieldError>{addProject.error.message}</FieldError>
				) : null}
			</FieldGroup>
			<DialogFooter>
				<DialogClose render={<Button variant="outline" type="button" />}>
					Cancel
				</DialogClose>
				<Button type="submit" disabled={!canSubmit || busy}>
					{busy ? (
						<Spinner data-icon="inline-start" />
					) : (
						<PlusIcon data-icon="inline-start" />
					)}
					{addProject.isPending
						? "Adding…"
						: source === "github" && copying
							? "Copying…"
							: "Add project"}
				</Button>
			</DialogFooter>
		</form>
	);
}
