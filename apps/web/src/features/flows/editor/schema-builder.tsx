import { Button } from "@nightshift/ui/components/button";
import { Checkbox } from "@nightshift/ui/components/checkbox";
import { Field, FieldError, FieldLabel } from "@nightshift/ui/components/field";
import { Input } from "@nightshift/ui/components/input";
import { Item } from "@nightshift/ui/components/item";
import {
	NativeSelect,
	NativeSelectOption,
} from "@nightshift/ui/components/native-select";
import { PlusIcon, XIcon } from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";

import {
	emptyShape,
	fieldNameProblem,
	type SchemaField,
	type SchemaShape,
	SHAPE_KINDS,
	type ShapeKind,
} from "./lib/schema-builder";

/** A field name that is not taken yet: field, field_2, field_3 … */
function freshName(fields: readonly SchemaField[]): string {
	const names = new Set(fields.map((field) => field.name));
	if (!names.has("field")) return "field";
	let n = 2;
	while (names.has(`field_${n}`)) n++;
	return `field_${n}`;
}

/** The type picker of a shape. Changing the type starts the shape over. */
export function KindSelect({
	id,
	label,
	shape,
	kinds = SHAPE_KINDS,
	onChange,
}: {
	id: string;
	label: string;
	shape: SchemaShape;
	kinds?: typeof SHAPE_KINDS;
	onChange: (shape: SchemaShape) => void;
}) {
	return (
		<NativeSelect
			id={id}
			size="sm"
			value={shape.kind}
			aria-label={label}
			className="w-full text-xs"
			onChange={(event) =>
				onChange(emptyShape(event.target.value as ShapeKind, shape.description))
			}
		>
			{kinds.map(({ kind, label: text }) => (
				<NativeSelectOption key={kind} value={kind}>
					{text}
				</NativeSelectOption>
			))}
		</NativeSelect>
	);
}

/**
 * What a shape holds beyond its type: the values of a Choice, the element
 * of a List, the fields of an Object. Nothing for the simple types.
 */
export function ShapeDetails({
	shape,
	path,
	onChange,
}: {
	shape: SchemaShape;
	/** Where the shape sits, for labels: "tasks", "tasks item". */
	path: string;
	onChange: (shape: SchemaShape) => void;
}) {
	const id = useId();
	switch (shape.kind) {
		case "choice":
			return (
				<ChoiceValues
					id={`${id}-values`}
					path={path}
					values={shape.values}
					onChange={(values) => onChange({ ...shape, values })}
				/>
			);
		case "list":
			return (
				<div className="flex flex-col gap-1.5 border-l-2 pl-3">
					<Field className="gap-1.5">
						<FieldLabel
							htmlFor={`${id}-items`}
							className="font-normal text-muted-foreground text-xs"
						>
							Each item is
						</FieldLabel>
						<KindSelect
							id={`${id}-items`}
							label={`Type of each item in ${path}`}
							shape={shape.items}
							kinds={SHAPE_KINDS.filter(({ kind }) => kind !== "list")}
							onChange={(items) => onChange({ ...shape, items })}
						/>
					</Field>
					<ShapeDetails
						shape={shape.items}
						path={`${path} item`}
						onChange={(items) => onChange({ ...shape, items })}
					/>
				</div>
			);
		case "object":
			return (
				<FieldsEditor
					fields={shape.fields}
					path={path}
					nested
					onChange={(fields) => onChange({ ...shape, fields })}
				/>
			);
		default:
			return null;
	}
}

/** The values of a Choice, as text split on commas. Keeps what the person types. */
function ChoiceValues({
	id,
	path,
	values,
	onChange,
}: {
	id: string;
	path: string;
	values: string[];
	onChange: (values: string[]) => void;
}) {
	const [text, setText] = useState(values.join(", "));
	useEffect(() => {
		setText((current) =>
			split(current).join("\u0000") === values.join("\u0000")
				? current
				: values.join(", "),
		);
	}, [values]);
	const empty = values.length === 0;
	return (
		<div className="flex flex-col gap-1 border-l-2 pl-3">
			<Input
				id={id}
				value={text}
				aria-label={`Values of ${path}`}
				aria-invalid={empty}
				aria-describedby={empty ? `${id}-error` : undefined}
				placeholder="Values, split by commas: small, medium, large"
				className="h-8 font-mono text-xs"
				autoComplete="off"
				spellCheck={false}
				onChange={(event) => {
					setText(event.target.value);
					onChange(split(event.target.value));
				}}
			/>
			{empty ? (
				<FieldError id={`${id}-error`} className="text-xs">
					Add at least one value.
				</FieldError>
			) : null}
		</div>
	);
}

function split(text: string): string[] {
	return [
		...new Set(
			text
				.split(",")
				.map((value) => value.trim())
				.filter(Boolean),
		),
	];
}

/** The fields of an object, one row each, and a button to add one. */
export function FieldsEditor({
	fields,
	path,
	nested = false,
	onChange,
	aside,
}: {
	fields: SchemaField[];
	/** The object's place, for labels. Empty at the root. */
	path: string;
	nested?: boolean;
	onChange: (fields: SchemaField[]) => void;
	/** Shown next to the add button, such as a helper that suggests fields. */
	aside?: ReactNode;
}) {
	const update = (index: number, field: SchemaField) =>
		onChange(fields.map((current, at) => (at === index ? field : current)));

	return (
		<div
			className={
				nested
					? "flex flex-col gap-1.5 border-l-2 pl-3"
					: "flex flex-col gap-1.5"
			}
		>
			{fields.length > 0 ? (
				<ul className="flex flex-col gap-1.5">
					{fields.map((field, index) => (
						<FieldRow
							key={index}
							field={field}
							path={path}
							others={fields
								.filter((_, at) => at !== index)
								.map((other) => other.name)}
							onChange={(next) => update(index, next)}
							onRemove={() => onChange(fields.filter((_, at) => at !== index))}
						/>
					))}
				</ul>
			) : null}
			<div className="flex flex-wrap items-center gap-1.5">
				<Button
					variant="outline"
					size="xs"
					onClick={() =>
						onChange([
							...fields,
							{
								name: freshName(fields),
								required: true,
								shape: { kind: "text" },
							},
						])
					}
				>
					<PlusIcon data-icon="inline-start" />
					{nested ? `Add field to ${path}` : "Add field"}
				</Button>
				{aside}
			</div>
		</div>
	);
}

function FieldRow({
	field,
	path,
	others,
	onChange,
	onRemove,
}: {
	field: SchemaField;
	path: string;
	others: string[];
	onChange: (field: SchemaField) => void;
	onRemove: () => void;
}) {
	const id = useId();
	const problem = fieldNameProblem(field.name, others);
	const where = path
		? `${path}.${field.name || "field"}`
		: field.name || "field";
	const description = field.shape.description ?? "";

	return (
		<Item
			render={<li />}
			variant="outline"
			size="xs"
			className="flex-col items-stretch gap-1.5 bg-card"
		>
			<div className="flex items-center gap-1.5">
				<Input
					id={`${id}-name`}
					value={field.name}
					aria-label={`Name of ${where}`}
					aria-invalid={problem !== null}
					aria-describedby={problem ? `${id}-name-error` : undefined}
					placeholder="name"
					className="h-8 min-w-0 flex-1 font-mono text-xs"
					autoComplete="off"
					spellCheck={false}
					onChange={(event) =>
						onChange({ ...field, name: event.target.value.trim() })
					}
				/>
				<div className="w-32 shrink-0">
					<KindSelect
						id={`${id}-type`}
						label={`Type of ${where}`}
						shape={field.shape}
						onChange={(shape) => onChange({ ...field, shape })}
					/>
				</div>
				<Button
					variant="ghost"
					size="icon-xs"
					className="text-muted-foreground hover:text-destructive"
					aria-label={`Remove ${where}`}
					title="Remove this field"
					onClick={onRemove}
				>
					<XIcon />
				</Button>
			</div>
			{problem ? (
				<FieldError id={`${id}-name-error`} className="text-xs">
					{problem}
				</FieldError>
			) : null}
			<Input
				id={`${id}-description`}
				value={description}
				aria-label={`Description of ${where}`}
				placeholder="What it holds (optional)"
				className="h-8 text-xs"
				autoComplete="off"
				onChange={(event) => {
					const { description: _, ...shape } = field.shape;
					const text = event.target.value;
					onChange({
						...field,
						shape: (text
							? { ...shape, description: text }
							: shape) as SchemaShape,
					});
				}}
			/>
			<ShapeDetails
				shape={field.shape}
				path={where}
				onChange={(shape) => onChange({ ...field, shape })}
			/>
			<Field orientation="horizontal" className="gap-2 pt-0.5">
				<Checkbox
					id={`${id}-required`}
					checked={field.required}
					onCheckedChange={(checked) =>
						onChange({ ...field, required: checked === true })
					}
				/>
				<FieldLabel htmlFor={`${id}-required`} className="font-normal text-xs">
					Required
				</FieldLabel>
			</Field>
		</Item>
	);
}
