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
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@nightshift/ui/components/select";
import { Spinner } from "@nightshift/ui/components/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ArrowRightLeftIcon } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";

import type { Project } from "@/lib/api-types";
import { orpc } from "@/utils/orpc";

/** Renames a project for everyone in its Space. */
export function RenameProjectDialog({
	project,
	onOpenChange,
}: {
	/** The project to rename. None: the dialog is closed. */
	project: Project | null;
	onOpenChange: (open: boolean) => void;
}) {
	return (
		<Dialog open={project !== null} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				{project ? (
					<RenameProjectForm
						project={project}
						onDone={() => onOpenChange(false)}
					/>
				) : null}
			</DialogContent>
		</Dialog>
	);
}

function RenameProjectForm({
	project,
	onDone,
}: {
	project: Project;
	onDone: () => void;
}) {
	const id = useId();
	const queryClient = useQueryClient();
	const [name, setName] = useState(project.name);
	const rename = useMutation(
		orpc.projects.rename.mutationOptions({
			onSuccess: () => {
				void queryClient.invalidateQueries({ queryKey: orpc.projects.key() });
				onDone();
			},
		}),
	);
	const trimmed = name.trim();

	return (
		<form
			className="contents"
			onSubmit={(event) => {
				event.preventDefault();
				if (trimmed !== "") {
					rename.mutate({ projectId: project.id, name: trimmed });
				}
			}}
		>
			<DialogHeader>
				<DialogTitle>Rename {project.name}</DialogTitle>
				<DialogDescription>
					Everyone in this Space sees the new name. The folder keeps its name.
				</DialogDescription>
			</DialogHeader>
			<FieldGroup>
				<Field data-invalid={rename.error ? true : undefined}>
					<FieldLabel htmlFor={`${id}-name`}>Name</FieldLabel>
					<Input
						id={`${id}-name`}
						value={name}
						onChange={(event) => setName(event.target.value)}
						maxLength={100}
						autoComplete="off"
						autoFocus
					/>
					{rename.error ? (
						<FieldError>{rename.error.message}</FieldError>
					) : null}
				</Field>
			</FieldGroup>
			<DialogFooter>
				<DialogClose render={<Button variant="outline" type="button" />}>
					Cancel
				</DialogClose>
				<Button
					type="submit"
					disabled={
						trimmed === "" || trimmed === project.name || rename.isPending
					}
				>
					{rename.isPending ? <Spinner data-icon="inline-start" /> : null}
					{rename.isPending ? "Renaming…" : "Rename"}
				</Button>
			</DialogFooter>
		</form>
	);
}

/** Moves a project, with its runs and their history, to another Space. */
export function MoveProjectDialog({
	project,
	onOpenChange,
}: {
	/** The project to move. None: the dialog is closed. */
	project: Project | null;
	onOpenChange: (open: boolean) => void;
}) {
	return (
		<Dialog open={project !== null} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				{project ? (
					<MoveProjectForm
						project={project}
						onDone={() => onOpenChange(false)}
					/>
				) : null}
			</DialogContent>
		</Dialog>
	);
}

/** The personal Space always reads "Personal", whatever it is called. */
const spaceName = (space: { name: string; personal: boolean }) =>
	space.personal ? "Personal" : space.name;

function MoveProjectForm({
	project,
	onDone,
}: {
	project: Project;
	onDone: () => void;
}) {
	const id = useId();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const spaces = useQuery(orpc.spaces.list.queryOptions());
	// Only an owner or an admin of a Space may move projects into it.
	const targets = (spaces.data?.spaces ?? [])
		.filter(
			(space) =>
				space.id !== spaces.data?.active &&
				(space.role === "owner" || space.role === "admin"),
		)
		.map((space) => ({ value: space.id, label: spaceName(space) }));
	const [spaceId, setSpaceId] = useState<string | null>(null);
	const target = targets.find((t) => t.value === spaceId);

	const move = useMutation(
		orpc.projects.move.mutationOptions({
			onSuccess: async () => {
				toast.success(
					`Moved ${project.name} to ${target?.label ?? "the Space"}`,
				);
				onDone();
				// The project is no longer in this Space.
				await navigate({ to: "/" });
				await queryClient.invalidateQueries();
			},
		}),
	);

	return (
		<form
			className="contents"
			onSubmit={(event) => {
				event.preventDefault();
				if (spaceId) move.mutate({ projectId: project.id, spaceId });
			}}
		>
			<DialogHeader>
				<DialogTitle>Move {project.name} to another Space</DialogTitle>
				<DialogDescription>
					Its runs and their history move with it. The members of that Space see
					them there, and this Space no longer does.
				</DialogDescription>
			</DialogHeader>
			<FieldGroup>
				<Field data-invalid={move.error ? true : undefined}>
					<FieldLabel htmlFor={`${id}-space`}>Space</FieldLabel>
					<Select
						items={targets}
						value={spaceId}
						onValueChange={(value) => setSpaceId(value)}
						disabled={targets.length === 0}
					>
						<SelectTrigger id={`${id}-space`} className="w-full">
							<SelectValue placeholder="Choose a Space" />
						</SelectTrigger>
						<SelectContent>
							<SelectGroup>
								{targets.map((t) => (
									<SelectItem key={t.value} value={t.value}>
										{t.label}
									</SelectItem>
								))}
							</SelectGroup>
						</SelectContent>
					</Select>
					{targets.length === 0 && !spaces.isLoading ? (
						<FieldDescription>
							No other Space takes projects from you. Create one in the Space
							menu first.
						</FieldDescription>
					) : null}
					{move.error ? <FieldError>{move.error.message}</FieldError> : null}
				</Field>
			</FieldGroup>
			<DialogFooter>
				<DialogClose render={<Button variant="outline" type="button" />}>
					Cancel
				</DialogClose>
				<Button type="submit" disabled={!spaceId || move.isPending}>
					{move.isPending ? (
						<Spinner data-icon="inline-start" />
					) : (
						<ArrowRightLeftIcon data-icon="inline-start" />
					)}
					{move.isPending ? "Moving…" : "Move project"}
				</Button>
			</DialogFooter>
		</form>
	);
}
