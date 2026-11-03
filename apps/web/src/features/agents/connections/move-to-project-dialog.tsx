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
import { projectQueries } from "@/features/projects";
import {
	connectionQueries,
	projectSecretMutations,
	projectSecretQueries,
} from "../queries";
import type { SecretScope } from "./secret-parts";

/**
 * Where a secret moves into a project from: a scope of this computer's
 * owner, or another of their devices, which moves its own value.
 */
export type MoveSource =
	| { scope: SecretScope }
	| { deviceId: string; deviceName: string };

/** A saved secret to move, and where it is now. */
export type MoveTarget = { name: string; from: MoveSource };

/**
 * Moves a saved secret into a project of the Space you work in (ADR 13):
 * Night Shift saves it as the project's, then removes the old copy. You
 * never type it again. The success toast opens the project's Secrets page.
 */
export function MoveToProjectDialog({
	target,
	onOpenChange,
	onMoved,
}: {
	target: MoveTarget | null;
	onOpenChange: (open: boolean) => void;
	/** After the move, beside the lists this dialog refreshes. */
	onMoved?: (target: MoveTarget) => void;
}) {
	return (
		<Dialog open={target !== null} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				{target !== null ? (
					<MoveToProjectForm
						target={target}
						onDone={() => {
							onMoved?.(target);
							onOpenChange(false);
						}}
					/>
				) : null}
			</DialogContent>
		</Dialog>
	);
}

function MoveToProjectForm({
	target,
	onDone,
}: {
	target: MoveTarget;
	onDone: () => void;
}) {
	const id = useId();
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const projects = useQuery(projectQueries.list());
	const choices = (projects.data ?? []).map((project) => ({
		value: project.id,
		label: project.name,
	}));
	const [projectId, setProjectId] = useState<string | null>(null);
	const chosen = choices.find((choice) => choice.value === projectId);
	const moved = (_: unknown, input: { projectId: string }) => {
		toast.success(`Moved ${target.name} to ${chosen?.label ?? "the project"}`, {
			action: {
				label: "Open secrets",
				onClick: () =>
					void navigate({
						to: "/projects/$projectId/secrets",
						params: { projectId: input.projectId },
					}),
			},
		});
		void queryClient.invalidateQueries({
			queryKey: connectionQueries.lists(),
		});
		void queryClient.invalidateQueries({
			queryKey: projectSecretQueries.lists(),
		});
		onDone();
	};
	const moveIn = useMutation(
		projectSecretMutations.moveIn({ onSuccess: moved }),
	);
	const moveFromDevice = useMutation(
		projectSecretMutations.moveFromDevice({ onSuccess: moved }),
	);
	const { from } = target;
	const move = "deviceId" in from ? moveFromDevice : moveIn;

	return (
		<form
			className="contents"
			onSubmit={(event) => {
				event.preventDefault();
				if (!projectId) return;
				if ("deviceId" in from) {
					moveFromDevice.mutate({
						projectId,
						name: target.name,
						deviceId: from.deviceId,
					});
				} else {
					moveIn.mutate({ projectId, name: target.name, from: from.scope });
				}
			}}
		>
			<DialogHeader>
				<DialogTitle>
					Move <span className="font-mono">{target.name}</span> to a project
				</DialogTitle>
				<DialogDescription>
					Every step of the project's runs can use it, on any computer. Everyone
					who can change the project's flows can use it.
				</DialogDescription>
			</DialogHeader>
			<FieldGroup>
				<Field data-invalid={move.error ? true : undefined}>
					<FieldLabel htmlFor={`${id}-project`}>Project</FieldLabel>
					<Select
						items={choices}
						value={projectId}
						onValueChange={(value) => setProjectId(value)}
						disabled={choices.length === 0}
					>
						<SelectTrigger id={`${id}-project`} className="w-full">
							<SelectValue placeholder="Choose a project" />
						</SelectTrigger>
						<SelectContent>
							<SelectGroup>
								{choices.map((choice) => (
									<SelectItem key={choice.value} value={choice.value}>
										{choice.label}
									</SelectItem>
								))}
							</SelectGroup>
						</SelectContent>
					</Select>
					{choices.length === 0 && !projects.isLoading ? (
						<FieldDescription>
							This Space has no projects yet. Add one first.
						</FieldDescription>
					) : "deviceId" in from ? (
						<FieldDescription>
							{from.deviceName} moves it. It must be online.
						</FieldDescription>
					) : null}
					{move.error ? <FieldError>{move.error.message}</FieldError> : null}
				</Field>
			</FieldGroup>
			<DialogFooter>
				<DialogClose render={<Button variant="outline" type="button" />}>
					Cancel
				</DialogClose>
				<Button type="submit" disabled={!projectId || move.isPending}>
					{move.isPending ? (
						<Spinner data-icon="inline-start" />
					) : (
						<ArrowRightLeftIcon data-icon="inline-start" />
					)}
					{move.isPending ? "Moving…" : "Move"}
				</Button>
			</DialogFooter>
		</form>
	);
}
