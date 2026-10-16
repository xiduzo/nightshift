import { labelSchema, reservedOutcomes } from "@nightshift/flows";
import { Button } from "@nightshift/ui/components/button";
import { FieldError } from "@nightshift/ui/components/field";
import { Input } from "@nightshift/ui/components/input";
import { Item } from "@nightshift/ui/components/item";
import { cn } from "@nightshift/ui/lib/utils";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, XIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { outcomeStyle } from "@/components/outcome-badge";
import { type NodeOption, uniqueOptionName } from "@/lib/flow-draft";

type Kind = "label" | "choice" | "outcome";

const RESERVED: readonly string[] = reservedOutcomes;

/**
 * The labels of a Decision node or the choices of a Gate node. Each one is an
 * outcome with its own handle. A name commits on blur or Enter, so the edges
 * on it follow one rename and not every keystroke. Without `onDescribe` and
 * `onMove` it edits a plain list of names, for example a For Each's halt-on
 * labels.
 */
export function OptionsEditor({
	kind,
	options,
	min,
	describedBy,
	newName,
	onRename,
	onDescribe,
	onAdd,
	onRemove,
	onMove,
}: {
	kind: Kind;
	options: NodeOption[];
	/** The schema's minimum; removing stops there. */
	min: number;
	describedBy?: string;
	/** The name a new entry starts with. Defaults to the noun. */
	newName?: string;
	/** Returns an error when the name cannot be used. */
	onRename: (index: number, name: string) => string | null;
	onDescribe?: (index: number, description: string | undefined) => void;
	onAdd: (option: NodeOption) => void;
	onRemove: (index: number) => void;
	onMove?: (index: number, to: number) => void;
}) {
	const id = useId();
	const noun = kind;
	const [focusIndex, setFocusIndex] = useState<number | null>(null);

	return (
		<div className="flex flex-col gap-2">
			<ol className="flex flex-col gap-1.5" aria-describedby={describedBy}>
				{options.map((option, index) => (
					<OptionRow
						// Options have no ids; the row follows its place in the list.
						key={index}
						id={`${id}-${index}`}
						noun={noun}
						option={option}
						index={index}
						count={options.length}
						canRemove={options.length > min}
						min={min}
						autoFocus={focusIndex === index}
						onRename={(name) => {
							const taken = options.some(
								(other, at) => at !== index && other.name === name,
							);
							if (taken) return `Another ${noun} is named ${name}.`;
							return onRename(index, name);
						}}
						onDescribe={
							onDescribe
								? (description) => onDescribe(index, description)
								: undefined
						}
						onRemove={() => onRemove(index)}
						onMove={onMove ? (to) => onMove(index, to) : undefined}
					/>
				))}
			</ol>
			<Button
				variant="outline"
				size="sm"
				className="self-start"
				onClick={() => {
					setFocusIndex(options.length);
					onAdd({ name: uniqueOptionName(options, newName ?? noun) });
				}}
			>
				<PlusIcon data-icon="inline-start" />
				Add {noun}
			</Button>
		</div>
	);
}

function OptionRow({
	id,
	noun,
	option,
	index,
	count,
	canRemove,
	min,
	autoFocus,
	onRename,
	onDescribe,
	onRemove,
	onMove,
}: {
	id: string;
	noun: string;
	option: NodeOption;
	index: number;
	count: number;
	canRemove: boolean;
	min: number;
	autoFocus: boolean;
	onRename: (name: string) => string | null;
	onDescribe?: (description: string | undefined) => void;
	onRemove: () => void;
	onMove?: (to: number) => void;
}) {
	const [text, setText] = useState(option.name);
	const [error, setError] = useState<string | null>(null);
	const nameRef = useRef<HTMLInputElement>(null);

	// Follow outside changes: a reorder, a removal above, an undo.
	useEffect(() => {
		setText(option.name);
		setError(null);
	}, [option.name]);

	useEffect(() => {
		if (autoFocus) nameRef.current?.select();
	}, [autoFocus]);

	const commit = () => {
		const next = text.trim();
		if (next === option.name) {
			setText(option.name);
			setError(null);
			return;
		}
		const parsed = labelSchema.safeParse(next);
		if (!parsed.success) {
			setError(parsed.error.issues[0]?.message ?? "Not a valid name.");
			return;
		}
		if (RESERVED.includes(next)) {
			setError(`Night Shift uses the name ${next} itself. Pick another name.`);
			return;
		}
		setError(onRename(next));
	};

	const style = outcomeStyle(option.name);
	const position = `${noun} ${index + 1}`;

	return (
		<Item
			render={<li />}
			variant="outline"
			size="xs"
			className="flex-col items-stretch gap-1.5 border-l-4 bg-card"
			style={{ borderLeftColor: style.color }}
		>
			<div className="flex items-center gap-0.5">
				<Input
					ref={nameRef}
					id={`${id}-name`}
					value={text}
					aria-label={`Name of ${position}`}
					aria-invalid={error !== null}
					aria-describedby={error ? `${id}-error` : undefined}
					className={cn("h-8 flex-1 font-mono text-xs", style.text)}
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
							setText(option.name);
							setError(null);
						}
					}}
				/>
				{onMove ? (
					<>
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label={`Move ${option.name} up`}
							title="Move up"
							disabled={index === 0}
							onClick={() => onMove(index - 1)}
						>
							<ArrowUpIcon />
						</Button>
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label={`Move ${option.name} down`}
							title="Move down"
							disabled={index === count - 1}
							onClick={() => onMove(index + 1)}
						>
							<ArrowDownIcon />
						</Button>
					</>
				) : null}
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label={`Remove ${option.name}`}
					title={
						canRemove
							? onMove
								? `Remove this ${noun} and its edges`
								: `Remove this ${noun}`
							: `Keep at least ${min} ${min === 1 ? noun : `${noun}s`}.`
					}
					disabled={!canRemove}
					onClick={onRemove}
				>
					<XIcon />
				</Button>
			</div>
			{error ? (
				<FieldError id={`${id}-error`} className="text-xs">
					{error}
				</FieldError>
			) : null}
			{onDescribe ? (
				<Input
					id={`${id}-description`}
					value={option.description ?? ""}
					aria-label={`Description of ${position}`}
					placeholder="What it means (optional)"
					className="h-8 text-xs"
					autoComplete="off"
					onChange={(event) => {
						const description = event.target.value;
						onDescribe(description || undefined);
					}}
				/>
			) : null}
		</Item>
	);
}
