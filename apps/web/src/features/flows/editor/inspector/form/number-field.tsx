import type { ComponentProps } from "react";
import { Field, hintId, PositiveIntInput } from "./fields";

/** A labelled number above 0, or empty for "not set". */
export function NumberField({
	id,
	label,
	optional,
	hint,
	error,
	...input
}: Pick<
	ComponentProps<typeof Field>,
	"id" | "label" | "optional" | "hint" | "error"
> &
	Omit<ComponentProps<typeof PositiveIntInput>, "describedBy">) {
	return (
		<Field id={id} label={label} optional={optional} hint={hint} error={error}>
			<PositiveIntInput
				id={id}
				describedBy={hintId({ id, hint, error })}
				{...input}
			/>
		</Field>
	);
}
