import {
	FieldDescription,
	FieldError,
	FieldLabel,
	Field as ShadcnField,
} from "@nightshift/ui/components/field";
import { Input } from "@nightshift/ui/components/input";
import { cn } from "@nightshift/ui/lib/utils";
import { type ReactNode, useEffect, useState } from "react";
import { PanelSection } from "@/shared/panel";

/** The muted "(optional)" after a label. */
export function Optional({ children = "optional" }: { children?: ReactNode }) {
	return (
		<span className="font-normal text-muted-foreground">({children})</span>
	);
}

/**
 * A labelled form row with an optional hint or error below: shadcn's Field,
 * FieldLabel, FieldDescription and FieldError. The hint and the error share
 * the id `${id}-hint`, so a control's `aria-describedby` finds either.
 */
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
		<ShadcnField
			data-invalid={error ? true : undefined}
			className={cn("gap-2", className)}
		>
			<FieldLabel htmlFor={id}>
				{label}
				{optional ? <Optional /> : null}
			</FieldLabel>
			{children}
			{error ? (
				<FieldError id={`${id}-hint`} className="text-xs">
					{error}
				</FieldError>
			) : hint ? (
				<FieldDescription id={`${id}-hint`} className="text-xs">
					{hint}
				</FieldDescription>
			) : null}
		</ShadcnField>
	);
}

/** A short note under a group of fields, such as what later nodes can read. */
export function Note({
	id,
	children,
	className,
}: {
	id?: string;
	children: ReactNode;
	className?: string;
}) {
	return (
		<p
			id={id}
			className={cn(
				"text-muted-foreground text-xs leading-relaxed [&_code]:rounded-sm [&_code]:bg-muted [&_code]:px-1 [&_code]:py-px [&_code]:font-mono [&_code]:text-foreground",
				className,
			)}
		>
			{children}
		</p>
	);
}

/**
 * One section of the inspector: a separator, a small uppercase heading, and
 * the fields. Every section folds from its heading.
 */
export function InspectorSection({
	title,
	description,
	aside,
	defaultOpen = true,
	children,
	className,
}: {
	title: ReactNode;
	description?: ReactNode;
	/** A badge or count beside the heading. */
	aside?: ReactNode;
	/** Closed at first: for settings that most nodes leave alone. */
	defaultOpen?: boolean;
	children: ReactNode;
	className?: string;
}) {
	return (
		<PanelSection title={title} aside={aside} defaultOpen={defaultOpen}>
			<div className={cn("flex flex-col gap-5", className)}>
				{description ? <Note>{description}</Note> : null}
				{children}
			</div>
		</PanelSection>
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
				className="tabular-nums"
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
				<FieldError className="text-xs">
					{decimal
						? "Use a number above 0, or leave it empty."
						: "Use a whole number above 0, or leave it empty."}
				</FieldError>
			) : null}
		</>
	);
}
