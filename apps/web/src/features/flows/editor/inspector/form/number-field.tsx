import type { ComponentProps } from "react";
import { Field, PositiveIntInput } from "./fields";

/** A labelled number above 0, or empty for "not set". */
export function NumberField({
	id,
	label,
	optional,
	hint,
	error,
	describedBy = hint || error ? `${id}-hint` : undefined,
	...input
}: Pick<
	ComponentProps<typeof Field>,
	"id" | "label" | "optional" | "hint" | "error"
> &
	ComponentProps<typeof PositiveIntInput>) {
	return (
		<Field id={id} label={label} optional={optional} hint={hint} error={error}>
			<PositiveIntInput id={id} describedBy={describedBy} {...input} />
		</Field>
	);
}
