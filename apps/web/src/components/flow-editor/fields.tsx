import { Input } from "@nightshift/ui/components/input";
import { Label } from "@nightshift/ui/components/label";
import { cn } from "@nightshift/ui/lib/utils";
import { type ReactNode, useEffect, useState } from "react";

/** A labelled form row with an optional hint or error below. */
export function Field({
	id,
	label,
	optional,
	hint,
	error,
	children,
	className,
}: {
	id: string;
	label: ReactNode;
	optional?: boolean;
	hint?: ReactNode;
	error?: string | null;
	children: ReactNode;
	className?: string;
}) {
	return (
		<div className={cn("flex flex-col gap-1.5", className)}>
			<Label htmlFor={id}>
				{label}
				{optional ? (
					<span className="text-muted-foreground">(optional)</span>
				) : null}
			</Label>
			{children}
			{error ? (
				<p id={`${id}-hint`} role="alert" className="text-destructive text-xs">
					{error}
				</p>
			) : hint ? (
				<p id={`${id}-hint`} className="text-muted-foreground text-xs">
					{hint}
				</p>
			) : null}
		</div>
	);
}

function parsePositive(text: string, decimal: boolean): number | null {
	const trimmed = text.trim();
	if (!(decimal ? /^\d+(\.\d+)?$/ : /^\d+$/).test(trimmed)) return null;
	const value = Number(trimmed);
	if (!(value > 0)) return null;
	return decimal || Number.isSafeInteger(value) ? value : null;
}

/**
 * A whole number above 0 (or with `decimal`, any number above 0), or empty for
 * "not set". Keeps what the person types while it is not a valid number yet,
 * and commits only valid values.
 */
export function PositiveIntInput({
	id,
	value,
	onChange,
	placeholder,
	describedBy,
	decimal = false,
}: {
	id: string;
	value: number | undefined;
	onChange: (value: number | undefined) => void;
	placeholder?: string;
	describedBy?: string;
	decimal?: boolean;
}) {
	const parsePositiveInt = (input: string) => parsePositive(input, decimal);
	const [text, setText] = useState(value?.toString() ?? "");

	// Follow outside changes, but keep a half-typed value that means the same.
	useEffect(() => {
		setText((current) => {
			const parsed =
				current.trim() === "" ? undefined : parsePositive(current, decimal);
			return parsed === value ? current : (value?.toString() ?? "");
		});
	}, [value, decimal]);

	const invalid = text.trim() !== "" && parsePositiveInt(text) === null;

	return (
		<>
			<Input
				id={id}
				inputMode={decimal ? "decimal" : "numeric"}
				value={text}
				placeholder={placeholder}
				aria-invalid={invalid}
				aria-describedby={describedBy}
				autoComplete="off"
				onChange={(event) => {
					const next = event.target.value;
					setText(next);
					if (next.trim() === "") onChange(undefined);
					else {
						const parsed = parsePositiveInt(next);
						if (parsed !== null) onChange(parsed);
					}
				}}
			/>
			{invalid ? (
				<p role="alert" className="text-destructive text-xs">
					{decimal
						? "Use a number above 0, or leave it empty."
						: "Use a whole number above 0, or leave it empty."}
				</p>
			) : null}
		</>
	);
}
