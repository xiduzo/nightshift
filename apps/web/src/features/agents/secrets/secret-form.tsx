import { Button } from "@nightshift/ui/components/button";
import {
	DialogClose,
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
import { useMutation } from "@tanstack/react-query";
import { type ReactNode, useId, useState } from "react";
import { toast } from "sonner";
import { ErrorAlert } from "@/shared/failure";
import { SECRET_NAME } from "./secret-parts";

/** The form that saves a secret of any owner: `fixedName` null asks for the name too. */
export function SecretForm({
	fixedName,
	addTitle = "Add secret",
	description,
	placeholder = "GITHUB_TOKEN",
	nameHint,
	saved,
	valueHint,
	save,
	children,
	onDone,
}: {
	fixedName: string | null;
	addTitle?: string;
	description: ReactNode;
	placeholder?: string;
	/** What the name is for, below it. */
	nameHint?: (name: string) => ReactNode;
	/** It has a value now: the new one replaces it. */
	saved: boolean;
	/** What the value needs, when there is none yet. */
	valueHint: string;
	save: (value: { name: string; value: string }) => Promise<unknown>;
	children?: ReactNode;
	onDone: () => void;
}) {
	const id = useId();
	const [name, setName] = useState(fixedName ?? "");
	const [value, setValue] = useState("");
	const setSecret = useMutation({
		mutationFn: save,
		onSuccess: () => {
			toast.success(`Saved ${name}`);
			onDone();
		},
	});
	const trimmedName = name.trim();
	const nameInvalid = trimmedName !== "" && !SECRET_NAME.test(trimmedName);
	const canSave = SECRET_NAME.test(trimmedName) && value !== "";

	return (
		<form
			className="contents"
			onSubmit={(event) => {
				event.preventDefault();
				if (!canSave) return;
				setSecret.mutate({ name: trimmedName, value });
			}}
		>
			<DialogHeader>
				<DialogTitle>
					{fixedName ? (
						<>
							Set <span className="font-mono">{fixedName}</span>
						</>
					) : (
						addTitle
					)}
				</DialogTitle>
				<DialogDescription>{description}</DialogDescription>
			</DialogHeader>
			<FieldGroup className="gap-5">
				{fixedName ? null : (
					<Field data-invalid={nameInvalid || undefined}>
						<FieldLabel htmlFor={`${id}-name`}>Name</FieldLabel>
						<Input
							id={`${id}-name`}
							value={name}
							onChange={(event) => setName(event.target.value)}
							placeholder={placeholder}
							className="font-mono"
							autoComplete="off"
							spellCheck={false}
							autoFocus
							aria-invalid={nameInvalid || undefined}
						/>
						{nameInvalid ? (
							<FieldError>
								Start with a letter or _. Use letters, digits and _.
							</FieldError>
						) : nameHint ? (
							<FieldDescription>{nameHint(trimmedName)}</FieldDescription>
						) : null}
					</Field>
				)}
				<Field>
					<FieldLabel htmlFor={`${id}-value`}>Value</FieldLabel>
					<Input
						id={`${id}-value`}
						type="password"
						value={value}
						onChange={(event) => setValue(event.target.value)}
						className="font-mono"
						autoComplete="off"
						spellCheck={false}
						autoFocus={Boolean(fixedName)}
					/>
					<FieldDescription>
						{saved ? "A new value replaces the saved one." : valueHint}
					</FieldDescription>
				</Field>
				{children}
				<ErrorAlert title="Not saved" error={setSecret.error} />
			</FieldGroup>
			<DialogFooter>
				<DialogClose render={<Button variant="outline" type="button" />}>
					Cancel
				</DialogClose>
				<Button type="submit" disabled={!canSave || setSecret.isPending}>
					{setSecret.isPending ? <Spinner data-icon="inline-start" /> : null}
					{setSecret.isPending ? "Saving…" : "Save"}
				</Button>
			</DialogFooter>
		</form>
	);
}
