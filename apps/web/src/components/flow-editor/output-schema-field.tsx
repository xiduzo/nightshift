import { Button } from "@nightshift/ui/components/button";
import { Label } from "@nightshift/ui/components/label";
import { Textarea } from "@nightshift/ui/components/textarea";
import { useEffect, useState } from "react";

import { schemaFields } from "@/lib/flow-draft";

type Schema = Record<string, unknown>;

const PRESETS: { label: string; schema: Schema }[] = [
	{
		label: "List of strings",
		schema: { type: "array", items: { type: "string" } },
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
	},
];

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
			error: `Not JSON: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return {
			error: 'A JSON Schema is an object, for example {"type": "array"}.',
		};
	}
	return { schema: value as Schema };
}

/**
 * The JSON Schema for the `data` of an Agent's step report. Keeps what the
 * person types; commits only text that parses to an object (or empty).
 */
export function OutputSchemaField({
	id,
	nodeId,
	output,
	onChange,
}: {
	id: string;
	nodeId: string;
	output: Schema | undefined;
	onChange: (output: Schema | undefined) => void;
}) {
	const [text, setText] = useState(() => show(output));
	const result = parse(text);
	const error = "error" in result ? result.error : null;

	// Follow outside changes (an undo, a preset), but keep text that means the same.
	useEffect(() => {
		setText((current) => {
			const parsed = parse(current);
			if ("schema" in parsed && show(parsed.schema) === show(output))
				return current;
			return show(output);
		});
	}, [output]);

	const fields = schemaFields(output);

	return (
		<section className="flex flex-col gap-1.5" aria-labelledby={`${id}-label`}>
			<div className="flex flex-wrap items-center gap-1">
				<Label id={`${id}-label`} htmlFor={id} className="shrink-0">
					Output schema
					<span className="text-muted-foreground">(optional)</span>
				</Label>
				<div className="ml-auto flex items-center gap-1">
					{PRESETS.map((preset) => (
						<Button
							key={preset.label}
							variant="ghost"
							size="xs"
							title={`Start from: ${preset.label}`}
							onClick={() => {
								setText(show(preset.schema));
								onChange(preset.schema);
							}}
						>
							{preset.label}
						</Button>
					))}
				</div>
			</div>
			<Textarea
				id={id}
				value={text}
				placeholder={
					'{\n  "type": "array",\n  "items": { "type": "string" }\n}'
				}
				className="max-h-80 min-h-20 font-mono text-xs"
				spellCheck={false}
				aria-invalid={error !== null}
				aria-describedby={`${id}-hint`}
				onChange={(event) => {
					const next = event.target.value;
					setText(next);
					const parsed = parse(next);
					if ("schema" in parsed) onChange(parsed.schema);
				}}
			/>
			<p
				id={`${id}-hint`}
				role={error ? "alert" : undefined}
				className={
					error ? "text-destructive text-xs" : "text-muted-foreground text-xs"
				}
			>
				{error ??
					(output === undefined ? (
						"A JSON Schema for the report's data. The step fails when the data does not match."
					) : (
						<>
							Later nodes read{" "}
							<code className="font-mono">{`{{${nodeId}.data}}`}</code>
							{fields.length > 0 ? (
								<>
									{" "}
									or a field:{" "}
									{fields.map((field, index) => (
										<span key={field.name}>
											{index > 0 ? ", " : null}
											<code className="font-mono">{`{{${nodeId}.data.${field.name}}}`}</code>
										</span>
									))}
								</>
							) : null}
							. A list feeds a For Each.
						</>
					))}
			</p>
		</section>
	);
}
