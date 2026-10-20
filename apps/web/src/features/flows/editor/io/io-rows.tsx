/** The parts the rows of inputs, outputs and variables share: the name, the row buttons, the move. */
import { type Flow, nameSchema } from "@nightshift/flows";
import { Button } from "@nightshift/ui/components/button";
import { FieldError } from "@nightshift/ui/components/field";
import { Input } from "@nightshift/ui/components/input";
import { ArrowDownIcon, ArrowUpIcon, XIcon } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

export type Change = (change: (flow: Flow) => Flow) => void;

/** The list with the element at `from` moved to `to`. */
export function move<T>(list: T[], from: number, to: number): T[] {
	const next = [...list];
	const [moved] = next.splice(from, 1);
	if (moved !== undefined) next.splice(to, 0, moved);
	return next;
}

/** A name that commits on blur or Enter, and goes back on Escape. */
export function NameInput({
	id,
	name,
	label,
	autoFocus,
	onCommit,
	children,
}: {
	id: string;
	name: string;
	label: string;
	autoFocus: boolean;
	/** Returns an error when the name cannot be used. */
	onCommit: (name: string) => string | null;
	/** Buttons beside the name. */
	children: ReactNode;
}) {
	const [text, setText] = useState(name);
	const [error, setError] = useState<string | null>(null);
	const ref = useRef<HTMLInputElement>(null);

	// Follow outside changes: a reorder, a removal above, an undo.
	useEffect(() => {
		setText(name);
		setError(null);
	}, [name]);

	useEffect(() => {
		if (autoFocus) ref.current?.select();
	}, [autoFocus]);

	const commit = () => {
		const next = text.trim();
		if (next === name) {
			setText(name);
			setError(null);
			return;
		}
		const parsed = nameSchema.safeParse(next);
		if (!parsed.success) {
			setError(parsed.error.issues[0]?.message ?? "Not a valid name.");
			return;
		}
		setError(onCommit(next));
	};

	return (
		<>
			<div className="flex items-center gap-0.5">
				<Input
					ref={ref}
					id={id}
					value={text}
					aria-label={label}
					aria-invalid={error !== null}
					aria-describedby={error ? `${id}-error` : undefined}
					className="h-8 min-w-0 flex-1 font-mono text-xs"
					autoComplete="off"
					spellCheck={false}
					onChange={(event) => {
						setText(event.target.value);
						setError(null);
					}}
					onBlur={commit}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							commit();
						} else if (event.key === "Escape") {
							setText(name);
							setError(null);
						}
					}}
				/>
				{children}
			</div>
			{error ? (
				<FieldError id={`${id}-error`} className="text-xs">
					{error}
				</FieldError>
			) : null}
		</>
	);
}

export function RowButtons({
	name,
	noun,
	index,
	count,
	onMove,
	onRemove,
}: {
	name: string;
	noun: string;
	index: number;
	count: number;
	onMove: (to: number) => void;
	onRemove: () => void;
}) {
	return (
		<>
			<Button
				variant="ghost"
				size="icon-sm"
				aria-label={`Move ${name} up`}
				title="Move up"
				disabled={index === 0}
				onClick={() => onMove(index - 1)}
			>
				<ArrowUpIcon />
			</Button>
			<Button
				variant="ghost"
				size="icon-sm"
				aria-label={`Move ${name} down`}
				title="Move down"
				disabled={index === count - 1}
				onClick={() => onMove(index + 1)}
			>
				<ArrowDownIcon />
			</Button>
			<Button
				variant="ghost"
				size="icon-sm"
				aria-label={`Remove ${name}`}
				title={`Remove this ${noun}`}
				onClick={onRemove}
			>
				<XIcon />
			</Button>
		</>
	);
}
