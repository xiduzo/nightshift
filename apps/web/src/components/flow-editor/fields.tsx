import { Button } from "@nightshift/ui/components/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@nightshift/ui/components/collapsible";
import {
	FieldDescription,
	FieldError,
	FieldLabel,
	Field as ShadcnField,
} from "@nightshift/ui/components/field";
import { Input } from "@nightshift/ui/components/input";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemMedia,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { Separator } from "@nightshift/ui/components/separator";
import { cn } from "@nightshift/ui/lib/utils";
import { ChevronRightIcon, type LucideIcon } from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";

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
 * The top of the inspector: what is selected, as a shadcn Item with the
 * type's icon, a small kicker, the id in mono, and the actions on it.
 */
export function InspectorHeader({
	icon: Icon,
	kicker,
	title,
	badges,
	actions,
}: {
	icon: LucideIcon;
	kicker: ReactNode;
	title: ReactNode;
	badges?: ReactNode;
	actions?: ReactNode;
}) {
	return (
		<Item size="sm" className="flex-nowrap rounded-none border-0 p-4">
			<ItemMedia
				variant="icon"
				className="size-9 rounded-lg border bg-muted text-muted-foreground"
			>
				<Icon aria-hidden="true" />
			</ItemMedia>
			<ItemContent className="min-w-0 gap-0.5">
				<ItemDescription className="flex items-center gap-1.5 text-xs uppercase tracking-wider">
					{kicker}
					{badges}
				</ItemDescription>
				<ItemTitle className="block w-full truncate font-mono">
					<h2 className="truncate">{title}</h2>
				</ItemTitle>
			</ItemContent>
			{actions ? <ItemActions className="gap-1">{actions}</ItemActions> : null}
		</Item>
	);
}

/** The small uppercase heading of an inspector section. */
function SectionTitle({ children }: { children: ReactNode }) {
	return (
		<span className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
			{children}
		</span>
	);
}

/**
 * One section of the inspector: a separator, a small uppercase heading, and
 * the fields. A collapsible section opens from its heading, for advanced
 * settings that most nodes leave alone.
 */
export function InspectorSection({
	title,
	description,
	aside,
	collapsible = false,
	defaultOpen = true,
	children,
	className,
}: {
	title: ReactNode;
	description?: ReactNode;
	/** A badge or count beside the heading. */
	aside?: ReactNode;
	collapsible?: boolean;
	defaultOpen?: boolean;
	children: ReactNode;
	className?: string;
}) {
	const id = useId();
	const [open, setOpen] = useState(defaultOpen);
	const body = (
		<div className={cn("flex flex-col gap-5", className)}>
			{description ? <Note>{description}</Note> : null}
			{children}
		</div>
	);

	if (!collapsible) {
		return (
			<>
				<Separator />
				<section aria-labelledby={id} className="flex flex-col gap-4 p-4">
					<h3 id={id} className="flex min-h-5 items-center gap-2">
						<SectionTitle>{title}</SectionTitle>
						{aside}
					</h3>
					{body}
				</section>
			</>
		);
	}

	return (
		<>
			<Separator />
			<Collapsible
				open={open}
				onOpenChange={setOpen}
				render={<section aria-labelledby={id} />}
			>
				<h3 id={id}>
					<CollapsibleTrigger
						render={
							<Button
								variant="ghost"
								className="group/section h-12 w-full justify-start gap-2 rounded-none px-4"
							/>
						}
					>
						<ChevronRightIcon
							className="size-3.5 text-muted-foreground transition-transform group-data-panel-open/section:rotate-90 motion-reduce:transition-none"
							aria-hidden="true"
						/>
						<SectionTitle>{title}</SectionTitle>
						{aside}
					</CollapsibleTrigger>
				</h3>
				<CollapsibleContent className="px-4 pt-1 pb-4">
					{body}
				</CollapsibleContent>
			</Collapsible>
		</>
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
