import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
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
	FieldContent,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
	FieldLegend,
	FieldSet,
	FieldTitle,
} from "@nightshift/ui/components/field";
import { Input } from "@nightshift/ui/components/input";
import {
	RadioGroup,
	RadioGroupItem,
} from "@nightshift/ui/components/radio-group";
import { Spinner } from "@nightshift/ui/components/spinner";
import { useMutation } from "@tanstack/react-query";
import { CircleAlertIcon } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import type { SecretView } from "@/shared/api";
import { connectionMutations } from "../queries";
import type { SecretRef } from "./secret-columns";
import { SCOPE, SECRET_NAME, type SecretScope } from "./secret-parts";

/**
 * Saves a value, as Personal or for this computer. A `target` with no name
 * asks for the name too; null is closed.
 */
export function SecretDialog({
	target,
	secret,
	personal,
	onOpenChange,
}: {
	target: SecretRef | null;
	secret: SecretView | null;
	/** Personal can be chosen now. */
	personal: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	return (
		<Dialog open={target !== null} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				{target !== null ? (
					<SecretForm
						fixedName={target.name || null}
						initialScope={target.scope}
						secret={secret}
						personal={personal}
						onDone={() => onOpenChange(false)}
					/>
				) : null}
			</DialogContent>
		</Dialog>
	);
}

/** Where a new value goes: Personal or this computer. */
function ScopeChoice({
	value,
	personal,
	onChange,
}: {
	value: SecretScope;
	personal: boolean;
	onChange: (scope: SecretScope) => void;
}) {
	const id = useId();
	return (
		<FieldSet>
			<FieldLegend variant="label">Who can use it</FieldLegend>
			<RadioGroup
				value={value}
				onValueChange={(next) => onChange(next as SecretScope)}
			>
				{(["personal", "computer"] as const).map((scope) => {
					const { label, hint } = SCOPE[scope];
					const disabled = scope === "personal" && !personal;
					return (
						<FieldLabel key={scope} htmlFor={`${id}-${scope}`}>
							<Field
								orientation="horizontal"
								data-disabled={disabled || undefined}
							>
								<FieldContent>
									<FieldTitle>{label}</FieldTitle>
									<FieldDescription>
										{disabled
											? "Not available now. Check that this computer is online."
											: hint}
									</FieldDescription>
								</FieldContent>
								<RadioGroupItem
									value={scope}
									id={`${id}-${scope}`}
									disabled={disabled}
								/>
							</Field>
						</FieldLabel>
					);
				})}
			</RadioGroup>
		</FieldSet>
	);
}

function SecretForm({
	fixedName,
	initialScope,
	secret,
	personal,
	onDone,
}: {
	fixedName: string | null;
	initialScope: SecretScope;
	secret: SecretView | null;
	personal: boolean;
	onDone: () => void;
}) {
	const id = useId();
	const [name, setName] = useState(fixedName ?? "");
	const [value, setValue] = useState("");
	const [scope, setScope] = useState<SecretScope>(initialScope);
	const setSecret = useMutation(
		connectionMutations.setSecret({
			onSuccess: () => {
				toast.success(`Saved ${name}`);
				onDone();
			},
		}),
	);
	const trimmedName = name.trim();
	const nameInvalid = trimmedName !== "" && !SECRET_NAME.test(trimmedName);
	const canSave = SECRET_NAME.test(trimmedName) && value !== "";
	// A saved value keeps its place. A new one, or one without a value, chooses.
	const chooses = !secret?.saved;

	return (
		<form
			className="contents"
			onSubmit={(event) => {
				event.preventDefault();
				if (!canSave) return;
				setSecret.mutate({ name: trimmedName, value, scope });
			}}
		>
			<DialogHeader>
				<DialogTitle>
					{fixedName ? (
						<>
							Set <span className="font-mono">{fixedName}</span>
						</>
					) : (
						"Add secret"
					)}
				</DialogTitle>
				<DialogDescription>
					Night Shift keeps it safe and never shows it again.
					{secret?.inEnv
						? " It replaces the value that is set outside Night Shift."
						: null}
				</DialogDescription>
			</DialogHeader>
			<FieldGroup className="gap-5">
				{fixedName ? null : (
					<Field data-invalid={nameInvalid || undefined}>
						<FieldLabel htmlFor={`${id}-name`}>Name</FieldLabel>
						<Input
							id={`${id}-name`}
							value={name}
							onChange={(event) => setName(event.target.value)}
							placeholder="GITHUB_TOKEN"
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
						) : (
							<FieldDescription>
								Tools use it as{" "}
								<span className="font-mono">
									${"{"}
									{trimmedName || "NAME"}
									{"}"}
								</span>
								.
							</FieldDescription>
						)}
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
						{secret?.saved
							? "A new value replaces the saved one."
							: "Paste it once. To change it later, set it again."}
					</FieldDescription>
				</Field>
				{chooses ? (
					<ScopeChoice value={scope} personal={personal} onChange={setScope} />
				) : null}
				{setSecret.error ? (
					<Alert variant="destructive">
						<CircleAlertIcon />
						<AlertTitle>Not saved</AlertTitle>
						<AlertDescription>{setSecret.error.message}</AlertDescription>
					</Alert>
				) : null}
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
