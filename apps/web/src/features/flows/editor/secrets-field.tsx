import {
	Combobox,
	ComboboxChip,
	ComboboxChips,
	ComboboxChipsInput,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxItem,
	ComboboxList,
	ComboboxValue,
	useComboboxAnchor,
} from "@nightshift/ui/components/combobox";
import {
	FieldDescription,
	FieldError,
	FieldLegend,
	FieldSet,
} from "@nightshift/ui/components/field";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { Link } from "@tanstack/react-router";
import { Fragment } from "react";

import type { SecretView } from "@/shared/api";

import { Note } from "./fields";

/** Whether this computer has a value for the secret: saved, or set outside Night Shift. */
function hasSecretValue(secret: SecretView | undefined): boolean {
	return secret !== undefined && (secret.saved || secret.inEnv);
}

/** What the editor says about a secret this computer has no value for. */
function missingSecretMessage(name: string): string {
	return `The secret ${name} is not saved on this computer. The step stops before the command runs. Save it on the Secrets page, or remove it here.`;
}

/**
 * The secrets a Command node reads: names from the Secrets page. A
 * multiple Combobox with a chip per name; a name without a value on this
 * computer stays as a destructive chip, so it can be removed.
 */
export function SecretsField({
	id,
	names,
	secrets,
	onChange,
}: {
	id: string;
	names: readonly string[];
	/** The secrets of this computer; undefined while they load. */
	secrets: readonly SecretView[] | undefined;
	onChange: (names: string[]) => void;
}) {
	const anchor = useComboboxAnchor();

	if (secrets === undefined) {
		return (
			<div className="flex flex-col gap-2" aria-busy="true">
				<Skeleton className="h-9 w-full" />
				<Skeleton className="h-3 w-2/3" />
			</div>
		);
	}

	const byName = new Map(secrets.map((secret) => [secret.name, secret]));
	const known = secrets
		.filter((secret) => hasSecretValue(secret))
		.map((secret) => secret.name);
	const missing = names.filter((name) => !hasSecretValue(byName.get(name)));

	if (known.length === 0 && names.length === 0) {
		return (
			<Note>
				There are no secrets yet.{" "}
				<Link
					to="/secrets"
					className="text-foreground underline underline-offset-4 hover:text-primary"
				>
					Add one under Secrets
				</Link>
				, then pick it here.
			</Note>
		);
	}

	return (
		<FieldSet
			className="gap-2"
			data-invalid={missing.length > 0 ? true : undefined}
		>
			<FieldLegend variant="label" className="sr-only">
				Secrets (optional)
			</FieldLegend>
			<Combobox
				multiple
				autoHighlight
				items={known}
				value={[...names]}
				onValueChange={(value: string[]) => onChange(value)}
			>
				<ComboboxChips
					ref={anchor}
					className="w-full"
					aria-invalid={missing.length > 0 ? true : undefined}
				>
					<ComboboxValue>
						{(values: string[]) => (
							<Fragment>
								{values.map((name) => {
									const unknown = missing.includes(name);
									return (
										<ComboboxChip
											key={name}
											className={
												unknown
													? "bg-destructive/10 font-mono text-destructive dark:bg-destructive/20"
													: "font-mono"
											}
											title={unknown ? missingSecretMessage(name) : undefined}
										>
											{name}
										</ComboboxChip>
									);
								})}
								<ComboboxChipsInput
									id={id}
									placeholder={values.length > 0 ? "" : "Pick secrets"}
									aria-describedby={`${id}-hint`}
								/>
							</Fragment>
						)}
					</ComboboxValue>
				</ComboboxChips>
				<ComboboxContent anchor={anchor}>
					<ComboboxEmpty>No secret with that name.</ComboboxEmpty>
					<ComboboxList>
						{(name: string) => (
							<ComboboxItem key={name} value={name}>
								<span className="truncate font-mono">{name}</span>
							</ComboboxItem>
						)}
					</ComboboxList>
				</ComboboxContent>
			</Combobox>
			{missing.map((name) => (
				<FieldError key={name} className="text-xs">
					{missingSecretMessage(name)}
				</FieldError>
			))}
			<FieldDescription id={`${id}-hint`} className="text-xs">
				The command can read these as{" "}
				<span className="font-mono">${"{NAME}"}</span>. Night Shift hides their
				values in the log. A tool with a login under Agents → Tools needs none
				of its secrets here.
			</FieldDescription>
		</FieldSet>
	);
}
