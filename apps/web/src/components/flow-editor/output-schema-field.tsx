import { Button } from "@nightshift/ui/components/button";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldLabel,
} from "@nightshift/ui/components/field";
import { Textarea } from "@nightshift/ui/components/textarea";
import {
	ToggleGroup,
	ToggleGroupItem,
} from "@nightshift/ui/components/toggle-group";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { schemaFields } from "@/lib/flow-draft";
import {
	fromJsonSchema,
	type SchemaShape,
	SHAPE_KINDS,
	shapeIsValid,
	toJsonSchema,
} from "@/lib/schema-builder";

import { Note } from "./fields";
import { FieldsEditor, KindSelect, ShapeDetails } from "./schema-builder";

type Schema = Record<string, unknown>;
type Mode = "fields" | "json";

const PRESETS: { label: string; schema: Schema; object: boolean }[] = [
	{
		label: "List of strings",
		schema: { type: "array", items: { type: "string" } },
		object: false,
	},
	{
		label: "Object with fields",
		schema: {
			type: "object",
			properties: {
				title: { type: "string" },
				items: { type: "array", items: { type: "string" } },
			},
			required: ["title"],
		},
		object: true,
	},
];

const EMPTY_OBJECT: SchemaShape = { kind: "object", fields: [] };

function show(schema: Schema | undefined): string {
	return schema === undefined ? "" : JSON.stringify(schema, null, 2);
}

/** Parses the text: undefined for empty, a schema object, or an error. */
function parse(
	text: string,
): { schema: Schema | undefined } | { error: string } {
	if (text.trim() === "") return { schema: undefined };
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch (error) {
		return {
			error: `This is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return {
			error: 'Start with { and end with }, for example {"type": "array"}.',
		};
	}
	return { schema: value as Schema };
}

/** The shape the fields view can show for `schema`, or null. */
function shapeOf(
	schema: Schema | undefined,
	rootObject: boolean,
): SchemaShape | null {
	if (schema === undefined) return EMPTY_OBJECT;
	const shape = fromJsonSchema(schema);
	if (!shape || (rootObject && shape.kind !== "object")) return null;
	return shape;
}

/**
 * The shape of the `data` of an Agent's step report, or of the value a Value
 * node makes (`required`, with its own `description`). Two views of one
 * JSON Schema: fields to fill in, like a zod object, or the JSON itself for
 * what the fields cannot show. Commits only a complete schema.
 */
export function OutputSchemaField({
	id,
	nodeId,
	output,
	onChange,
	required = false,
	rootObject = false,
	description = "The shape of the data the agent must report. The step fails when the data does not fit.",
	children,
}: {
	id: string;
	nodeId: string;
	output: Schema | undefined;
	onChange: (output: Schema | undefined) => void;
	/** The node cannot do without a schema: no "(optional)" on the label. */
	required?: boolean;
	/** The data must be an object (an Agent's report): no other root type. */
	rootObject?: boolean;
	/** What the schema is for, shown until the node has one. */
	description?: string;
	/** Shown above the fields, such as a field the node always has. */
	children?: ReactNode;
}) {
	const [mode, setMode] = useState<Mode>(() =>
		shapeOf(output, rootObject) ? "fields" : "json",
	);
	const [shape, setShape] = useState<SchemaShape>(
		() => shapeOf(output, rootObject) ?? EMPTY_OBJECT,
	);
	const [text, setText] = useState(() => show(output));
	/** The schema this field sent last, to tell its own changes from outside ones. */
	const sent = useRef(show(output));

	const result = parse(text);
	const error = "error" in result ? result.error : null;
	const textShape =
		"schema" in result ? shapeOf(result.schema, rootObject) : null;

	// Follow outside changes (an undo, a preset), but keep drafts that mean the same.
	useEffect(() => {
		const next = show(output);
		if (next === sent.current) return;
		sent.current = next;
		setText(next);
		const shown = shapeOf(output, rootObject);
		if (shown) setShape(shown);
		else setMode("json");
	}, [output, rootObject]);

	const send = (schema: Schema | undefined) => {
		sent.current = show(schema);
		onChange(schema);
	};

	const editShape = (next: SchemaShape) => {
		setShape(next);
		if (!shapeIsValid(next)) return;
		const empty = next.kind === "object" && next.fields.length === 0;
		const schema = empty && !required ? undefined : toJsonSchema(next);
		setText(show(schema));
		send(schema);
	};

	const fields = schemaFields(output);

	return (
		<Field className="gap-2" data-invalid={error !== null ? true : undefined}>
			<FieldLabel id={`${id}-label`} htmlFor={mode === "json" ? id : undefined}>
				Output data
				{required ? null : (
					<span className="font-normal text-muted-foreground">(optional)</span>
				)}
			</FieldLabel>
			<ToggleGroup
				variant="outline"
				size="sm"
				spacing={0}
				aria-label="Edit the output data as"
				className="w-full"
				value={[mode]}
				onValueChange={(value) => {
					const next = value[0] as Mode | undefined;
					if (!next) return;
					if (next === "fields" && textShape) setShape(textShape);
					setMode(next);
				}}
			>
				<ToggleGroupItem
					value="fields"
					disabled={mode === "json" && !textShape}
					className="flex-1 aria-pressed:bg-primary aria-pressed:text-primary-foreground"
				>
					Fields
				</ToggleGroupItem>
				<ToggleGroupItem
					value="json"
					className="flex-1 aria-pressed:bg-primary aria-pressed:text-primary-foreground"
				>
					JSON
				</ToggleGroupItem>
			</ToggleGroup>

			{mode === "fields" ? (
				<fieldset
					aria-labelledby={`${id}-label`}
					className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0"
				>
					{rootObject ? null : (
						<Field className="gap-1.5">
							<FieldLabel
								htmlFor={`${id}-root`}
								className="font-normal text-muted-foreground text-xs"
							>
								The data is
							</FieldLabel>
							<KindSelect
								id={`${id}-root`}
								label="Type of the data"
								shape={shape}
								kinds={SHAPE_KINDS}
								onChange={editShape}
							/>
						</Field>
					)}
					{children}
					{shape.kind === "object" ? (
						<FieldsEditor
							fields={shape.fields}
							path=""
							onChange={(next) => editShape({ ...shape, fields: next })}
						/>
					) : (
						<ShapeDetails shape={shape} path="data" onChange={editShape} />
					)}
				</fieldset>
			) : (
				<>
					{children}
					{textShape === null && error === null && text.trim() !== "" ? (
						<Note>
							This schema uses more than the fields can show. Edit it here.
						</Note>
					) : null}
					<div className="flex flex-wrap items-center gap-1">
						{PRESETS.filter((preset) => !rootObject || preset.object).map(
							(preset) => (
								<Button
									key={preset.label}
									variant="outline"
									size="xs"
									className="font-normal"
									title={`Start from: ${preset.label}`}
									onClick={() => {
										setText(show(preset.schema));
										send(preset.schema);
									}}
								>
									{preset.label}
								</Button>
							),
						)}
					</div>
					<Textarea
						id={id}
						value={text}
						placeholder={
							rootObject
								? '{\n  "type": "object",\n  "properties": { "title": { "type": "string" } }\n}'
								: '{\n  "type": "array",\n  "items": { "type": "string" }\n}'
						}
						className="max-h-80 min-h-24 font-mono text-xs leading-relaxed"
						spellCheck={false}
						aria-invalid={error !== null}
						aria-describedby={`${id}-hint`}
						onChange={(event) => {
							const next = event.target.value;
							setText(next);
							const parsed = parse(next);
							if ("schema" in parsed) send(parsed.schema);
						}}
					/>
				</>
			)}

			{error && mode === "json" ? (
				<FieldError id={`${id}-hint`} className="text-xs">
					{error}
				</FieldError>
			) : (
				<FieldDescription
					id={`${id}-hint`}
					className="text-xs [&_code]:font-mono"
				>
					{output === undefined || fields.length === 0 ? (
						description
					) : (
						<>
							Later nodes read{" "}
							<code className="font-mono">{`{{${nodeId}.data}}`}</code> or a
							field:{" "}
							{fields.map((field, index) => (
								<span key={field.name}>
									{index > 0 ? ", " : null}
									<code className="font-mono">{`{{${nodeId}.data.${field.name}}}`}</code>
								</span>
							))}
							. A list feeds a Subflow that runs once per item.
						</>
					)}
				</FieldDescription>
			)}
		</Field>
	);
}
