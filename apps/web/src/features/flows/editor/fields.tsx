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
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import { cn } from "@nightshift/ui/lib/utils";
import { ChevronRightIcon, InfoIcon } from "lucide-react";
import {
	type ReactNode,
	type RefObject,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import {
	ErrorCount,
	type InspectorTab,
	useInspectorTab,
} from "./inspector-tabs";

/** The muted "(optional)" after a label. */
export function Optional({ children = "optional" }: { children?: ReactNode }) {
	return (
		<span className="font-normal text-muted-foreground">({children})</span>
	);
}

/**
 * A labelled form row: shadcn's Field, FieldLabel and FieldError. The hint
 * sits behind an info icon beside the label, so the form stays quiet; an
 * error shows under the control. Both carry the id `${id}-hint`, so a
 * control's `aria-describedby` finds either.
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
			className={cn("gap-1.5", className)}
		>
			<div className="flex min-w-0 items-center gap-1">
				<FieldLabel htmlFor={id}>
					{label}
					{optional ? <Optional /> : null}
				</FieldLabel>
				{hint && !error ? (
					<Tooltip>
						<TooltipTrigger
							render={<span aria-hidden="true" />}
							className="inline-flex text-muted-foreground/70 hover:text-foreground"
						>
							<InfoIcon className="size-3.5" />
						</TooltipTrigger>
						<TooltipContent className="max-w-64">{hint}</TooltipContent>
					</Tooltip>
				) : null}
			</div>
			{children}
			{error ? (
				<FieldError id={`${id}-hint`} className="text-xs">
					{error}
				</FieldError>
			) : hint ? (
				<FieldDescription id={`${id}-hint`} className="sr-only">
					{hint}
				</FieldDescription>
			) : null}
		</ShadcnField>
	);
}

const NOTE =
	"text-muted-foreground text-xs leading-relaxed [&_code]:rounded-sm [&_code]:bg-muted [&_code]:px-1 [&_code]:py-px [&_code]:font-mono [&_code]:text-foreground";

/**
 * A short note under a group of fields, such as what later nodes can read.
 * It shows one line; a click shows all of it.
 */
export function Note({
	id,
	children,
	className,
}: {
	id?: string;
	children: ReactNode;
	className?: string;
}) {
	const [open, setOpen] = useState(false);
	if (open)
		return (
			<p id={id} className={cn(NOTE, className)}>
				{children}
			</p>
		);
	return (
		<button
			type="button"
			id={id}
			title="Show all"
			aria-expanded={false}
			className={cn(
				NOTE,
				"line-clamp-1 cursor-pointer rounded-sm text-left outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
				className,
			)}
			onClick={() => setOpen(true)}
		>
			{children}
		</button>
	);
}

/**
 * How many fields in `ref` have a problem, also in a folded section or a tab
 * that is not open. A field has a problem when a control is marked invalid
 * or when it shows a FieldError. A field with both counts once.
 */
function countProblems(element: HTMLElement): number {
	const invalid = element.querySelectorAll('[aria-invalid="true"]').length;
	const alone = [
		...element.querySelectorAll('[data-slot="field-error"]'),
	].filter(
		(error) =>
			!error
				.closest('[data-slot="field"]')
				?.querySelector('[aria-invalid="true"]'),
	).length;
	return invalid + alone;
}

function useErrorCount(ref: RefObject<HTMLElement | null>): number {
	const [count, setCount] = useState(0);
	useLayoutEffect(() => {
		const element = ref.current;
		if (!element) return;
		const update = () => setCount(countProblems(element));
		update();
		const observer = new MutationObserver(update);
		observer.observe(element, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: ["aria-invalid"],
		});
		return () => observer.disconnect();
	}, [ref]);
	return count;
}

/**
 * One section of the inspector: a heading that folds it, and the fields.
 * In the node inspector it shows only on its tab (`tab`, Work by default).
 * A folded section stays rendered, so its heading and its tab can show how
 * many errors it holds.
 */
export function InspectorSection({
	title,
	description,
	aside,
	tab = "work",
	defaultOpen = true,
	children,
	className,
}: {
	title: ReactNode;
	description?: ReactNode;
	/** A badge or count beside the heading. */
	aside?: ReactNode;
	/** The node inspector's tab the section is on. */
	tab?: InspectorTab;
	/** Closed at first: for settings that most nodes leave alone. */
	defaultOpen?: boolean;
	children: ReactNode;
	className?: string;
}) {
	const headingId = useId();
	const [open, setOpen] = useState(defaultOpen);
	const ref = useRef<HTMLDivElement>(null);
	const errors = useErrorCount(ref);
	const shown = useInspectorTab(tab, errors);
	return (
		<Collapsible
			ref={ref}
			open={open}
			onOpenChange={setOpen}
			hidden={!shown}
			className="border-t first:border-t-0"
			render={<section aria-labelledby={headingId} />}
		>
			<h3 id={headingId}>
				<CollapsibleTrigger
					render={
						<Button
							variant="ghost"
							className="group/section h-11 w-full justify-start gap-2 rounded-none px-4 aria-expanded:bg-transparent hover:aria-expanded:bg-muted dark:aria-expanded:bg-transparent dark:hover:aria-expanded:bg-muted/50"
						/>
					}
				>
					<span className="flex-1 text-left font-semibold text-sm">
						{title}
					</span>
					{aside}
					{open ? null : <ErrorCount count={errors} />}
					<ChevronRightIcon
						className="size-4 text-muted-foreground transition-transform group-data-panel-open/section:rotate-90 motion-reduce:transition-none"
						aria-hidden="true"
					/>
				</CollapsibleTrigger>
			</h3>
			<CollapsibleContent keepMounted className="px-4 pt-1 pb-5">
				<div className={cn("flex flex-col gap-4", className)}>
					{description ? <Note>{description}</Note> : null}
					{children}
				</div>
			</CollapsibleContent>
		</Collapsible>
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
	format = String,
}: {
	id: string;
	value: number | undefined;
	onChange: (value: number | undefined) => void;
	placeholder?: string;
	describedBy?: string;
	decimal?: boolean;
	/** How a saved value shows, for example dollars with cents. */
	format?: (value: number) => string;
}) {
	const parsePositiveInt = (input: string) => parsePositive(input, decimal);
	const [text, setText] = useState(value === undefined ? "" : format(value));

	// Follow outside changes, but keep a half-typed value that means the same.
	useEffect(() => {
		setText((current) => {
			const parsed =
				current.trim() === "" ? undefined : parsePositive(current, decimal);
			return parsed === value
				? current
				: value === undefined
					? ""
					: format(value);
		});
	}, [value, decimal, format]);

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
