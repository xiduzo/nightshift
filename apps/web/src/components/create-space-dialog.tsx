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
import { Spinner } from "@nightshift/ui/components/spinner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { PlusIcon } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";

/**
 * Creates a Space with you as its owner, then switches to it. Your
 * personal Space stays as it is.
 */
export function CreateSpaceDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				{open ? (
					<CreateSpaceForm onCreated={() => onOpenChange(false)} />
				) : null}
			</DialogContent>
		</Dialog>
	);
}

function CreateSpaceForm({ onCreated }: { onCreated: () => void }) {
	const id = useId();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [name, setName] = useState("");
	const create = useMutation(
		orpc.spaces.create.mutationOptions({
			onSuccess: async () => {
				toast.success(`Created ${name.trim()}`);
				onCreated();
				// You work in the new Space now: every page shows it.
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
				if (name.trim() !== "") create.mutate({ name: name.trim() });
			}}
		>
			<DialogHeader>
				<DialogTitle>Create Space</DialogTitle>
				<DialogDescription>
					A Space holds projects you share with other people. Your personal
					Space stays private.
				</DialogDescription>
			</DialogHeader>
			<FieldGroup>
				<Field data-invalid={create.error ? true : undefined}>
					<FieldLabel htmlFor={`${id}-name`}>Name</FieldLabel>
					<Input
						id={`${id}-name`}
						value={name}
						onChange={(event) => setName(event.target.value)}
						placeholder="Platform team"
						maxLength={60}
						autoComplete="off"
						autoFocus
					/>
					{create.error ? (
						<FieldError>{create.error.message}</FieldError>
					) : null}
				</Field>
			</FieldGroup>
			<DialogFooter>
				<DialogClose render={<Button variant="outline" type="button" />}>
					Cancel
				</DialogClose>
				<Button type="submit" disabled={name.trim() === "" || create.isPending}>
					{create.isPending ? (
						<Spinner data-icon="inline-start" />
					) : (
						<PlusIcon data-icon="inline-start" />
					)}
					{create.isPending ? "Creating…" : "Create Space"}
				</Button>
			</DialogFooter>
		</form>
	);
}
