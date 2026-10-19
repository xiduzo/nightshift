import { labelSchema, reservedOutcomes } from "@nightshift/flows";
import { Button } from "@nightshift/ui/components/button";
import { FieldError } from "@nightshift/ui/components/field";
import { Input } from "@nightshift/ui/components/input";
import { Item } from "@nightshift/ui/components/item";
import { cn } from "@nightshift/ui/lib/utils";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, XIcon } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";

import { outcomeStyle } from "@/components/outcome-badge";
import { type NodeOption, uniqueOptionName } from "@/lib/flow-draft";

type Kind = "option" | "outcome" | "exit";

const RESERVED: readonly string[] = reservedOutcomes;

/**
 * The options of a Decision node or the outcomes of an Agent node. Each one
 * is an outcome with its own handle. A name commits on blur or Enter, so the
 * edges on it follow one rename and not every keystroke. With `onRule`, each
 * row also takes the rule (`when`) that picks it. Without `onDescribe` and
 * `onMove` it edits a plain list of names, for example a Subflow's halt-on
 * labels. With `onCode`, each row also takes an exit code (a Command node).
 */
export function OptionsEditor({
	kind,
	options,
	min,
	describedBy,
	newName,
	onRename,
	onDescribe,
	onRule,
	onCode,
	onAdd,
	addControl,
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
	/** Decisions decided by a rule: the rule of each option. Empty removes it. */
	onRule?: (index: number, when: string | undefined) => void;
	/** Command nodes: the exit code of each row. Empty makes it the catch-all. */
	onCode?: (index: number, code: number | undefined) => void;
	onAdd: (option: NodeOption) => void;
	/** Replaces the add button, for example with a menu of common entries. */
	addControl?: ReactNode;
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
						onRule={onRule ? (when) => onRule(index, when) : undefined}
						onCode={onCode ? (code) => onCode(index, code) : undefined}
						onRemove={() => onRemove(index)}
						onMove={onMove ? (to) => onMove(index, to) : undefined}
					/>
				))}
			</ol>
			{addControl ?? (
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
			)}
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
	onRule,
	onCode,
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
	onRule?: (when: string | undefined) => void;
	onCode?: (code: number | undefined) => void;
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
				{onCode ? (
					<ExitCodeInput
						id={`${id}-code`}
						code={option.code}
						label={`Exit code of ${position}`}
						onChange={onCode}
					/>
				) : null}
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
			{onRule ? (
				<Input
					id={`${id}-when`}
					value={option.when ?? ""}
					aria-label={`Rule of ${position}`}
					placeholder={
						index === count - 1 && count > 1
							? "No rule: picked when none above holds"
							: "build.data.tests_passed = true"
					}
					className="h-8 font-mono text-xs"
					autoComplete="off"
					spellCheck={false}
					onChange={(event) => {
						const when = event.target.value;
						onRule(when || undefined);
					}}
				/>
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

/**
 * An exit code from 0 to 255, or empty for the catch-all. Keeps what the
 * person types while it is not a valid code yet.
 */
function ExitCodeInput({
	id,
	code,
	label,
	onChange,
}: {
	id: string;
	code: number | undefined;
	label: string;
	onChange: (code: number | undefined) => void;
}) {
	const [text, setText] = useState(code === undefined ? "" : String(code));

	useEffect(() => {
		setText(code === undefined ? "" : String(code));
	}, [code]);

	const valid = text.trim() === "" || /^(\d{1,3})$/.test(text.trim());
	const value = Number(text.trim());
	const inRange = text.trim() === "" || (valid && value <= 255);

	return (
		<Input
			id={id}
			value={text}
			inputMode="numeric"
			aria-label={label}
			aria-invalid={!inRange}
			title={
				inRange
					? "Exit code. Leave it empty for any other code."
					: "Use 0 to 255."
			}
			placeholder="any"
			className="h-8 w-14 shrink-0 text-center font-mono text-xs tabular-nums"
			autoComplete="off"
			onChange={(event) => {
				const next = event.target.value;
				setText(next);
				const trimmed = next.trim();
				if (trimmed === "") onChange(undefined);
				else if (/^\d{1,3}$/.test(trimmed) && Number(trimmed) <= 255) {
					onChange(Number(trimmed));
				}
			}}
		/>
	);
}
