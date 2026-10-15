import { type Flow, type Param, paramSchema } from "@nightshift/flows";
import { Button } from "@nightshift/ui/components/button";
import { Checkbox } from "@nightshift/ui/components/checkbox";
import { Input } from "@nightshift/ui/components/input";
import { Label } from "@nightshift/ui/components/label";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, XIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { renameParam, setParams, uniqueParamName } from "@/lib/flow-draft";

/**
 * The run parameters of a top-level flow: values asked when a run starts. A
 * name commits on blur or Enter, so the `{{params.name}}` references in the
 * flow follow one rename and not every keystroke.
 */
export function ParamsEditor({
	flow,
	describedBy,
	onChange,
}: {
	flow: Flow;
	describedBy?: string;
	onChange: (change: (flow: Flow) => Flow) => void;
}) {
	const id = useId();
	const params = flow.params ?? [];
	const [focusIndex, setFocusIndex] = useState<number | null>(null);

	const update = (index: number, change: (param: Param) => Param) =>
		onChange((current) =>
			setParams(
				current,
				(current.params ?? []).map((param, at) =>
					at === index ? change(param) : param,
				),
			),
		);

	return (
		<div className="flex flex-col gap-2">
			{params.length > 0 ? (
				<ol className="flex flex-col gap-2" aria-describedby={describedBy}>
					{params.map((param, index) => (
						<ParamRow
							// Params have no ids; the row follows its place in the list.
							key={index}
							id={`${id}-${index}`}
							param={param}
							index={index}
							count={params.length}
							autoFocus={focusIndex === index}
							onRename={(name) => {
								if (
									params.some(
										(other, at) => at !== index && other.name === name,
									)
								)
									return `Another parameter is named ${name}.`;
								onChange((current) => renameParam(current, index, name));
								return null;
							}}
							onUpdate={(change) => update(index, change)}
							onRemove={() =>
								onChange((current) =>
									setParams(
										current,
										(current.params ?? []).filter((_, at) => at !== index),
									),
								)
							}
							onMove={(to) =>
								onChange((current) => {
									const next = [...(current.params ?? [])];
									const [moved] = next.splice(index, 1);
									if (!moved) return current;
									next.splice(to, 0, moved);
									return setParams(current, next);
								})
							}
						/>
					))}
				</ol>
			) : null}
			<Button
				variant="outline"
				size="xs"
				className="self-start"
				onClick={() => {
					setFocusIndex(params.length);
					onChange((current) =>
						setParams(current, [
							...(current.params ?? []),
							{ name: uniqueParamName(current.params ?? [], "param") },
						]),
					);
				}}
			>
				<PlusIcon data-icon="inline-start" />
				Add parameter
			</Button>
		</div>
	);
}

function ParamRow({
	id,
	param,
	index,
	count,
	autoFocus,
	onRename,
	onUpdate,
	onRemove,
	onMove,
}: {
	id: string;
	param: Param;
	index: number;
	count: number;
	autoFocus: boolean;
	/** Returns an error when the name cannot be used. */
	onRename: (name: string) => string | null;
	onUpdate: (change: (param: Param) => Param) => void;
	onRemove: () => void;
	onMove: (to: number) => void;
}) {
	const [text, setText] = useState(param.name);
	const [error, setError] = useState<string | null>(null);
	const nameRef = useRef<HTMLInputElement>(null);

	// Follow outside changes: a reorder, a removal above, an undo.
	useEffect(() => {
		setText(param.name);
		setError(null);
	}, [param.name]);

	useEffect(() => {
		if (autoFocus) nameRef.current?.select();
	}, [autoFocus]);

	const commit = () => {
		const next = text.trim();
		if (next === param.name) {
			setText(param.name);
			setError(null);
			return;
		}
		const parsed = paramSchema.shape.name.safeParse(next);
		if (!parsed.success) {
			setError(parsed.error.issues[0]?.message ?? "Not a valid name.");
			return;
		}
		setError(onRename(next));
	};

	/** Sets an optional text field, dropping it when empty. */
	const setOptional = (
		key: "label" | "description" | "default",
		value: string,
	) =>
		onUpdate((current) => {
			const next: Param = { ...current, [key]: value };
			if (value === "") delete next[key];
			return next;
		});

	const position = `parameter ${index + 1}`;

	return (
		<li className="flex flex-col gap-1.5 border bg-card p-2">
			<div className="flex items-center gap-1">
				<Input
					ref={nameRef}
					id={`${id}-name`}
					value={text}
					aria-label={`Name of ${position}`}
					aria-invalid={error !== null}
					aria-describedby={error ? `${id}-error` : undefined}
					className="h-7 flex-1 font-mono"
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
							setText(param.name);
							setError(null);
						}
					}}
				/>
				<Button
					variant="ghost"
					size="icon-xs"
					aria-label={`Move ${param.name} up`}
					title="Move up"
					disabled={index === 0}
					onClick={() => onMove(index - 1)}
				>
					<ArrowUpIcon />
				</Button>
				<Button
					variant="ghost"
					size="icon-xs"
					aria-label={`Move ${param.name} down`}
					title="Move down"
					disabled={index === count - 1}
					onClick={() => onMove(index + 1)}
				>
					<ArrowDownIcon />
				</Button>
				<Button
					variant="ghost"
					size="icon-xs"
					aria-label={`Remove ${param.name}`}
					title="Remove this parameter"
					onClick={onRemove}
				>
					<XIcon />
				</Button>
			</div>
			{error ? (
				<p id={`${id}-error`} role="alert" className="text-destructive text-xs">
					{error}
				</p>
			) : null}
			<div className="grid grid-cols-2 gap-1.5">
				<Input
					id={`${id}-label`}
					value={param.label ?? ""}
					aria-label={`Label of ${position}`}
					placeholder="Label (optional)"
					className="h-7"
					autoComplete="off"
					onChange={(event) => setOptional("label", event.target.value)}
				/>
				<Input
					id={`${id}-default`}
					value={param.default ?? ""}
					aria-label={`Default of ${position}`}
					placeholder="Default (optional)"
					className="h-7 font-mono"
					autoComplete="off"
					spellCheck={false}
					onChange={(event) => setOptional("default", event.target.value)}
				/>
			</div>
			<Input
				id={`${id}-description`}
				value={param.description ?? ""}
				aria-label={`Description of ${position}`}
				placeholder="What to enter (optional)"
				className="h-7"
				autoComplete="off"
				onChange={(event) => setOptional("description", event.target.value)}
			/>
			<div className="flex items-center gap-2">
				<Checkbox
					id={`${id}-required`}
					checked={param.required === true}
					onCheckedChange={(checked) =>
						onUpdate(({ required: _, ...rest }) =>
							checked ? { ...rest, required: true } : rest,
						)
					}
				/>
				<Label htmlFor={`${id}-required`} className="font-normal text-xs">
					Required
					{param.default ? (
						<span className="text-muted-foreground">· the default counts</span>
					) : null}
				</Label>
			</div>
		</li>
	);
}
