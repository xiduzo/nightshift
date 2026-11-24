import {
	ToggleGroup,
	ToggleGroupItem,
} from "@nightshift/ui/components/toggle-group";
import type { ReactNode } from "react";
import { Field } from "./fields";

export type Choice<T extends string> = {
	value: T;
	label: string;
	icon?: ReactNode;
	disabled?: boolean;
};

/** One of a few choices, side by side. A click on the chosen one keeps it. */
export function ChoiceToggle<T extends string>({
	label,
	describedBy,
	className = "w-full",
	value,
	choices,
	onChange,
}: {
	/** What a screen reader calls the group. */
	label: string;
	describedBy?: string;
	className?: string;
	value: T;
	choices: readonly Choice<T>[];
	/** Not called for the chosen one. */
	onChange: (value: T) => void;
}) {
	return (
		<ToggleGroup
			variant="outline"
			size="sm"
			spacing={0}
			aria-label={label}
			aria-describedby={describedBy}
			className={className}
			value={[value]}
			onValueChange={([next]) => {
				if (next !== undefined && next !== value) onChange(next as T);
			}}
		>
			{choices.map((choice) => (
				<ToggleGroupItem
					key={choice.value}
					value={choice.value}
					disabled={choice.disabled}
					className="flex-1 aria-pressed:bg-primary aria-pressed:text-primary-foreground"
				>
					{choice.icon}
					{choice.label}
				</ToggleGroupItem>
			))}
		</ToggleGroup>
	);
}

/** A labelled `ChoiceToggle`. */
export function ChoiceField<T extends string>({
	id,
	label,
	hint,
	error,
	...toggle
}: {
	id: string;
	label: string;
	hint?: ReactNode;
	error?: string | null;
	describedBy?: string;
	value: T;
	choices: readonly Choice<T>[];
	onChange: (value: T) => void;
}) {
	return (
		<Field id={id} label={label} hint={hint} error={error}>
			<ChoiceToggle label={label} {...toggle} />
		</Field>
	);
}
