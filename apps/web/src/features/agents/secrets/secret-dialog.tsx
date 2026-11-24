import { Dialog, DialogContent } from "@nightshift/ui/components/dialog";
import {
	Field,
	FieldContent,
	FieldDescription,
	FieldLabel,
	FieldLegend,
	FieldSet,
	FieldTitle,
} from "@nightshift/ui/components/field";
import {
	RadioGroup,
	RadioGroupItem,
} from "@nightshift/ui/components/radio-group";
import { useMutation } from "@tanstack/react-query";
import { useId, useState } from "react";
import type { SecretView } from "@/shared/api";
import { connectionMutations } from "../queries";
import type { SecretRef } from "./secret-columns";
import { SecretForm } from "./secret-form";
import { SCOPE, type SecretScope } from "./secret-parts";

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
					<OwnSecretForm
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

function OwnSecretForm({
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
	const [scope, setScope] = useState<SecretScope>(initialScope);
	const set = useMutation(connectionMutations.setSecret());
	return (
		<SecretForm
			fixedName={fixedName}
			description={
				<>
					Night Shift keeps it safe and never shows it again.
					{secret?.inEnv
						? " It replaces the value that is set outside Night Shift."
						: null}
				</>
			}
			nameHint={(name) => (
				<>
					Tools use it as{" "}
					<span className="font-mono">
						${"{"}
						{name || "NAME"}
						{"}"}
					</span>
					.
				</>
			)}
			saved={secret?.saved ?? false}
			valueHint="Paste it once. To change it later, set it again."
			save={(value) => set.mutateAsync({ ...value, scope })}
			onDone={onDone}
		>
			{/* A saved value keeps its place. A new one, or one without a value, chooses. */}
			{secret?.saved ? null : (
				<ScopeChoice value={scope} personal={personal} onChange={setScope} />
			)}
		</SecretForm>
	);
}
