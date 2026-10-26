import {
	DATA_EXIT_CODE,
	labelSchema,
	type NodeOption,
	type OutcomeColor,
	outcomeColors,
	reservedOutcomes,
	uniqueOptionName,
} from "@nightshift/flows";
import { Button } from "@nightshift/ui/components/button";
import { FieldError } from "@nightshift/ui/components/field";
import { Input } from "@nightshift/ui/components/input";
import { Item } from "@nightshift/ui/components/item";
import {
	Popover,
	PopoverContent,
	PopoverDescription,
	PopoverHeader,
	PopoverTitle,
	PopoverTrigger,
} from "@nightshift/ui/components/popover";
import {
	ToggleGroup,
	ToggleGroupItem,
} from "@nightshift/ui/components/toggle-group";
import { cn } from "@nightshift/ui/lib/utils";
import {
	ArrowDownIcon,
	ArrowUpIcon,
	CheckIcon,
	PlusIcon,
	XIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";

import {
	defaultOutcomeColor,
	OUTCOME_COLOR_STYLE,
	outcomeStyle,
} from "../canvas/outcome-badge";

type Kind = "option" | "outcome" | "exit";

const RESERVED: readonly string[] = reservedOutcomes;

/**
 * The options of a Decision node or the outcomes of an Agent node. Each one
 * is an outcome with its own handle. A name commits on blur or Enter, so the
 * edges on it follow one rename and not every keystroke. With `onRule`, each
 * row also takes the rule (`when`) that picks it. Without `onDescribe` and
 * `onMove` it edits a plain list of names, for example a Subflow's halt-on
 * labels. With `onCode`, each row also takes an exit code (a Command node).
 * With `onColor`, each row also takes a colour for its handle and edges.
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
	onColor,
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
	/**
	 * Command nodes: the exit code of each row. Empty makes it the
	 * catch-all; `"data"` an exit the command picks in its data.
	 */
	onCode?: (index: number, code: NodeOption["code"]) => void;
	/** The colour of each row. Undefined goes back to the one from its name. */
	onColor?: (index: number, color: OutcomeColor | undefined) => void;
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
						onColor={onColor ? (color) => onColor(index, color) : undefined}
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
	onColor,
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
	onCode?: (code: NodeOption["code"]) => void;
	onColor?: (color: OutcomeColor | undefined) => void;
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

	const style = outcomeStyle(option.name, option.color);
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
				{onColor ? (
					<OutcomeColorPicker
						name={option.name}
						color={option.color}
						label={`Color of ${position}`}
						onChange={onColor}
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
 * A colour for an outcome, from the Tailwind colours. Without a pick, the
 * outcome takes a colour from its name, such as red for `failed`.
 */
function OutcomeColorPicker({
	name,
	color,
	label,
	onChange,
}: {
	name: string;
	color: OutcomeColor | undefined;
	label: string;
	onChange: (color: OutcomeColor | undefined) => void;
}) {
	const fallback = defaultOutcomeColor(name);
	const shown = color ?? fallback;

	return (
		<Popover>
			<PopoverTrigger
				render={
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={label}
						title="Change color"
					/>
				}
			>
				<span
					aria-hidden="true"
					className="size-3.5 rounded-full"
					style={{ background: OUTCOME_COLOR_STYLE[shown].color }}
				/>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-auto gap-3 p-3">
				<PopoverHeader>
					<PopoverTitle className="text-xs">Color</PopoverTitle>
					<PopoverDescription className="text-xs">
						The handle and edges of {name} use it.
					</PopoverDescription>
				</PopoverHeader>
				<ToggleGroup
					aria-label={label}
					spacing={1}
					className="grid grid-cols-7"
					value={color ? [color] : []}
					onValueChange={(value) =>
						onChange(value[0] as OutcomeColor | undefined)
					}
				>
					{outcomeColors.map((option) => (
						<ToggleGroupItem
							key={option}
							value={option}
							size="sm"
							aria-label={option}
							title={option}
						>
							<span
								aria-hidden="true"
								className="flex size-5 items-center justify-center rounded-full text-background"
								style={{ background: OUTCOME_COLOR_STYLE[option].color }}
							>
								{option === shown ? <CheckIcon className="size-3.5" /> : null}
							</span>
						</ToggleGroupItem>
					))}
				</ToggleGroup>
				<Button
					variant="outline"
					size="sm"
					disabled={color === undefined}
					onClick={() => onChange(undefined)}
				>
					Use the default color ({fallback})
				</Button>
			</PopoverContent>
		</Popover>
	);
}

/**
 * An exit code from 0 to 255, empty for the catch-all, or `data` for an
 * exit the command picks in its data. Keeps what the person types while it
 * is not a valid code yet.
 */
function ExitCodeInput({
	id,
	code,
	label,
	onChange,
}: {
	id: string;
	code: NodeOption["code"];
	label: string;
	onChange: (code: NodeOption["code"]) => void;
}) {
	const [text, setText] = useState(code === undefined ? "" : String(code));

	useEffect(() => {
		setText(code === undefined ? "" : String(code));
	}, [code]);

	const trimmed = text.trim();
	const valid =
		trimmed === "" ||
		trimmed === DATA_EXIT_CODE ||
		(/^\d{1,3}$/.test(trimmed) && Number(trimmed) <= 255);

	return (
		<Input
			id={id}
			value={text}
			aria-label={label}
			aria-invalid={!valid}
			title={
				valid
					? "Exit code. Leave it empty for any other code. Write data when the command picks this outcome in its data."
					: "Use 0 to 255, or data."
			}
			placeholder="any"
			className="h-8 w-14 shrink-0 text-center font-mono text-xs tabular-nums"
			autoComplete="off"
			onChange={(event) => {
				const next = event.target.value;
				setText(next);
				const value = next.trim();
				if (value === "") onChange(undefined);
				else if (value === DATA_EXIT_CODE) onChange(DATA_EXIT_CODE);
				else if (/^\d{1,3}$/.test(value) && Number(value) <= 255) {
					onChange(Number(value));
				}
			}}
		/>
	);
}
