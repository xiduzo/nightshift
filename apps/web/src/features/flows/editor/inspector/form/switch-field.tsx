import {
	Field,
	FieldContent,
	FieldDescription,
	FieldLabel,
} from "@nightshift/ui/components/field";
import { Switch } from "@nightshift/ui/components/switch";
import type { ReactNode } from "react";

/** A switch, with what it does beside it. */
export function SwitchField({
	id,
	label,
	description,
	checked,
	onChange,
}: {
	id: string;
	label: string;
	description: ReactNode;
	checked: boolean;
	onChange: (on: boolean) => void;
}) {
	return (
		<Field orientation="horizontal" className="items-start">
			<Switch
				id={id}
				checked={checked}
				className="mt-0.5"
				aria-describedby={`${id}-hint`}
				onCheckedChange={onChange}
			/>
			<FieldContent>
				<FieldLabel htmlFor={id}>{label}</FieldLabel>
				<FieldDescription id={`${id}-hint`} className="text-xs">
					{description}
				</FieldDescription>
			</FieldContent>
		</Field>
	);
}
